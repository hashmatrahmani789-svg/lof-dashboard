// GET /api/scan?key=YOUR_SCAN_KEY
// Checks your watchlist and sends a Telegram message when a market turns LONG or SHORT READY.
// Call it every 5 minutes from a free scheduler (cron-job.org), so alerts arrive even when the dashboard is closed.
// Env: SCAN_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, optional WATCHLIST (BTC,ETH,SOL), SCAN_TF (15m), SCAN_EVERY_MIN (5)
import { analyze } from '../js/engine.js';
import { send, query, getJson } from './_lib.js';

const FAPI = 'https://fapi.binance.com';
const TF = { '5m': 300, '15m': 900, '1h': 3600 };
const bars = (sym, iv, limit) => getJson(`${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=${limit}`)
  .then(j => j.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], bv: +k[10] })));
const fmt = p => p == null || !Number.isFinite(p) ? '—' : p.toLocaleString('en-US', { maximumFractionDigits: p >= 100 ? 1 : p >= 1 ? 3 : 6 });

async function telegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return (await r.json()).ok;
}

async function scanOne(base, tf, prem) {
  const sym = base + 'USDT';
  const [l, d, h4, m30, oi] = await Promise.all([bars(sym, tf, 402), bars(sym, '1d', 200), bars(sym, '4h', 200), bars(sym, '30m', 720),
    getJson(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=30`).catch(() => [])]);
  const closed = l.slice(0, -1);                                  // only finished candles
  const last = closed[closed.length - 1];
  const now = last.t + TF[tf];
  const run = (ltf, t) => analyze({ ltf, daily: d, h4, m30, now: t, params: { manual: false },
    flow: { perp: ltf.map(b => [b.t, 2 * b.bv - b.v, b.v]), spot: [], oi: oi.map(x => [Math.floor(x.timestamp / 1000), 0, 0, 0, +x.sumOpenInterestValue]), liq: [] },
    snap: { funding: prem[sym] } });
  const r = run(closed, now), prev = run(closed.slice(0, -1), now - TF[tf]);
  return { base, r, prev, closedAt: now };
}

export default async function handler(req, res) {
  const q = query(req);
  if (!process.env.SCAN_KEY || q.key !== process.env.SCAN_KEY) return send(res, 401, { error: 'wrong or missing key' });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return send(res, 501, { error: 'Telegram is not set up' });
  const tf = TF[process.env.SCAN_TF] ? process.env.SCAN_TF : '15m';
  const every = (Number(process.env.SCAN_EVERY_MIN) || 5) * 60;
  const list = String(process.env.WATCHLIST || 'BTC,ETH,SOL').split(',').map(x => x.trim().toUpperCase()).filter(Boolean).slice(0, 15);
  let prem = {};
  try { prem = Object.fromEntries((await getJson(`${FAPI}/fapi/v1/premiumIndex`)).map(x => [x.symbol, +x.lastFundingRate * 100])); } catch (e) { /* optional */ }
  const nowSec = Date.now() / 1000, out = [];
  for (const base of list) {
    try {
      const { r, prev, closedAt } = await scanOne(base, tf, prem);
      // alert once: the candle that turned the signal on closed since the previous scan
      const fresh = nowSec - closedAt < every + 30;
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
  if (q.test === '1') await telegram(`✅ LOF scanner is working. Watching ${list.join(', ')} on ${tf}.\n` + out.map(x => x.error ? `${x.base}: error ${x.error}` : `${x.base}: ${x.decision} · ${x.setup} · ${x.score}/9`).join('\n'));
  send(res, 200, { tf, results: out });
}
