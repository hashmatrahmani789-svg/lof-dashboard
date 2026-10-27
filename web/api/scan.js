// GET /api/scan?key=YOUR_SCAN_KEY   (called every 5 minutes by cron-job.org)
// 1. Checks your price alerts (1-minute candles since the last check) and sends Telegram messages.
// 2. Checks the Telegram watchlist for LONG / SHORT READY setups on closed candles.
// Env: SCAN_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, optional WATCHLIST, SCAN_TF (15m), SCAN_EVERY_MIN (5)
import { analyze } from '../js/engine.js';
import { runAlert, condText } from '../js/alertlogic.js';
import { send, query, getJson, UA } from './_lib.js';
import { storeOn, getKey, getAlerts, updateAlerts } from './_store.js';

const FAPI = 'https://fapi.binance.com';
const TF = { '5m': 300, '15m': 900, '1h': 3600 };
const toBars = j => j.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], bv: +k[10] }));
const bars = (sym, iv, limit) => getJson(`${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=${limit}`).then(toBars);
const fmt = p => p == null || !Number.isFinite(p) ? '—' : p.toLocaleString('en-US', { maximumFractionDigits: p >= 100 ? 1 : p >= 1 ? 3 : 6 });

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return (await r.json()).ok;
}

// ── price alerts ────────────────────────────────────────────
async function minuteBars(a, from) {
  if (a.tradfi) {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(a.sym)}?interval=1m&range=1d`, { 'User-Agent': UA });
    const r = j.chart.result[0], q = r.indicators.quote[0];
    return (r.timestamp || []).map((t, i) => ({ t, h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => b.h != null && b.t >= from - 60);
  }
  return toBars(await getJson(`${FAPI}/fapi/v1/klines?symbol=${a.sym}&interval=1m&limit=1000&startTime=${(from - 60) * 1000}`));
}
async function checkAlerts() {
  if (!storeOn()) return { alerts: 'storage not connected' };
  const active = (await getAlerts()).filter(a => a.status === 'active');
  if (!active.length) return { alerts: 0 };
  const now = Math.floor(Date.now() / 1000), changes = {}, fired = [];
  const bySym = {};
  active.forEach(a => { (bySym[a.sym] = bySym[a.sym] || []).push(a); });
  for (const list of Object.values(bySym)) {
    let candles;
    try { candles = await minuteBars(list[0], Math.min(...list.map(a => a.lastT || a.created))); } catch (e) { continue; }
    for (const a of list) {
      const hit = runAlert(a, candles);
      const patch = { side: a.side, lastT: a.lastT };
      if (hit && !(a.mode === 'every' && a.lastFired && now - a.lastFired < 900)) {
        if (a.mode !== 'every') { patch.status = 'triggered'; patch.triggeredAt = hit.t; }
        patch.lastFired = now;
        if (a.telegram !== false) fired.push(`🔔 <b>${a.key}</b> ${condText(a.cond)} ${fmt(hit.level)}${a.kind === 'line' ? ' (trend line)' : ''}\nPrice ${fmt(hit.price)} · ${new Date(hit.t * 1000).toISOString().slice(11, 16)} UTC${a.msg ? '\n' + a.msg : ''}`);
      }
      changes[a.id] = patch;
    }
  }
  await updateAlerts(list => { list.forEach(a => { if (changes[a.id] && a.status === 'active') Object.assign(a, changes[a.id]); }); return list; });
  for (const m of fired) await telegram(m);
  return { alerts: active.length, fired: fired.length };
}

// ── LONG / SHORT READY setups ───────────────────────────────
async function scanOne(base, tf, prem) {
  const sym = base + 'USDT';
  const [l, d, h4, m30, oi] = await Promise.all([bars(sym, tf, 402), bars(sym, '1d', 200), bars(sym, '4h', 200), bars(sym, '30m', 720),
    getJson(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=30`).catch(() => [])]);
  const closed = l.slice(0, -1);
  const now = closed[closed.length - 1].t + TF[tf];
  const run = (ltf, t) => analyze({ ltf, daily: d, h4, m30, now: t, params: { manual: false },
    flow: { perp: ltf.map(b => [b.t, 2 * b.bv - b.v, b.v]), spot: [], oi: oi.map(x => [Math.floor(x.timestamp / 1000), 0, 0, 0, +x.sumOpenInterestValue]), liq: [] },
    snap: { funding: prem[sym] } });
  return { r: run(closed, now), prev: run(closed.slice(0, -1), now - TF[tf]), closedAt: now };
}
async function watchlist() {
  // the list picked in the dashboard (watchlist panel → "Use for Telegram alerts"), else the WATCHLIST variable
  try {
    const L = await getKey('lists', null), v = L && L.value;
    if (v && v.lists && v.lists[v.scan]) {
      const items = v.lists[v.scan].items.filter(k => /^[A-Z0-9]+$/.test(k) && !['GOLD', 'SILVER', 'SPX', 'NDX', 'DXY', 'US2Y', 'US10Y', 'US30Y', 'VIX', 'OIL', 'ETHBTC', 'BTCD', 'ETHD', 'USDTD', 'TOTAL', 'TOTAL2', 'TOTAL3'].includes(k));
      if (items.length) return items.slice(0, 25);
    }
  } catch (e) { /* fall back */ }
  return String(process.env.WATCHLIST || 'BTC,ETH,SOL').split(',').map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 25);
}

export default async function handler(req, res) {
  const q = query(req);
  if (!process.env.SCAN_KEY || q.key !== process.env.SCAN_KEY) return send(res, 401, { error: 'wrong or missing key' });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return send(res, 501, { error: 'Telegram is not set up' });
  let alerts;
  try { alerts = await checkAlerts(); } catch (e) { alerts = { error: String(e.message || e) }; }
  const tf = TF[process.env.SCAN_TF] ? process.env.SCAN_TF : '15m';
  const every = (Number(process.env.SCAN_EVERY_MIN) || 5) * 60;
  const list = await watchlist();
  let prem = {};
  try { prem = Object.fromEntries((await getJson(`${FAPI}/fapi/v1/premiumIndex`)).map(x => [x.symbol, +x.lastFundingRate * 100])); } catch (e) { /* optional */ }
  const nowSec = Date.now() / 1000, out = [];
  const queue = list.slice();
  async function worker() {
    while (queue.length) {
      const base = queue.shift();
      try {
        const { r, prev, closedAt } = await scanOne(base, tf, prem);
        const fresh = nowSec - closedAt < every + 30;               // the candle that turned it on closed since the last scan
        const turnedOn = r.decision !== 'WAIT' && prev.decision !== r.decision;
        let sent = false;
        if (fresh && turnedOn) {
          sent = await telegram(`🔔 <b>${base} · ${r.decision} READY</b> (${tf})\n${r.setup} · score ${r.score}/9\nEntry ${fmt(r.price)}\nSL ${fmt(r.sl)}\nTP1 ${fmt(r.tp1)} · TP2 ${fmt(r.tp2)}\nR:R 1:${Number.isFinite(r.rr) ? r.rr.toFixed(2) : '—'} · ${r.loc.zone} · ${r.session}\n\nConfirm OI / CVD on Velo or Coinalyze before entering.`);
        }
        out.push({ base, decision: r.decision, score: r.score, setup: r.setup, sent });
      } catch (e) {
        out.push({ base, error: String(e.message || e) });
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  out.sort((a, b) => list.indexOf(a.base) - list.indexOf(b.base));
  if (q.test === '1') {
    await telegram(`✅ LOF scanner is working. Watching ${list.join(', ')} on ${tf}.\nPrice alerts: ${alerts.error ? 'error ' + alerts.error : typeof alerts.alerts === 'number' ? alerts.alerts + ' active' : alerts.alerts}\n` +
      out.map(x => x.error ? `${x.base}: error ${x.error}` : `${x.base}: ${x.decision} · ${x.setup} · ${x.score}/9`).join('\n'));
  }
  send(res, 200, { tf, alerts, results: out });
}
