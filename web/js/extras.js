// Screener, Market Pulse, setup history, alerts, killzone clock, news.
import * as API from './data.js';
import { analyze, isNum, nearestLevel, nyMinutes, nyParts } from './engine.js';
import { logo } from './logos.js';
import { $, esc, fp, fpct, fusd, tone, pill, tile, sparkSvg, dur, toast } from './ui.js';

// ── Screener ────────────────────────────────────────────────
export async function scanAsset(key, isCrypto, sym, ltf, params, prem) {
  let r, chg24, extra = {};
  if (isCrypto) {
    const [l, d, h4, m30, oi] = await Promise.all([API.klines(sym, ltf, 400), API.klines(sym, '1D', 200), API.klines(sym, '4h', 200),
      API.klines(sym, '30m', 720), API.binanceOiHist(sym, '1h', 30).catch(() => [])]);
    const flow = { perp: l.map(b => [b.t, 2 * b.bv - b.v, b.v]), spot: [], oi: oi.map(x => [x.t, 0, 0, 0, x.v]), liq: [] };
    const funding = prem && prem[sym] ? prem[sym].funding : NaN;
    r = analyze({ ltf: l, daily: d, h4, m30, flow, snap: { funding }, params: Object.assign({}, params, { manual: false }) });
    const past = l.filter(b => b.t <= r.now - 86400).pop();
    chg24 = past ? (r.price / past.c - 1) * 100 : NaN;
    extra = { oi4: r.oi_4h, funding };
  } else {
    const t = API.TRADFI[key].t;
    const [l, m30, h4, d] = await Promise.all([API.yahooBars(t, ltf), API.yahooRaw(t, '30m', '1mo').then(x => x.bars),
      API.yahooBars(t, '4h'), API.yahooRaw(t, '1d', '1y').then(x => x.bars)]);
    r = analyze({ ltf: l, daily: d, h4, m30, tradfi: true, params: Object.assign({}, params, { manual: false }) });
    chg24 = d.length > 1 ? (r.price / d[d.length - 2].c - 1) * 100 : NaN;
  }
  const near = nearestLevel(r);
  const sweep = r.struct.sw_bull ? 'bull' : r.struct.sw_bear ? 'bear' : '';
  return { key, sym, isCrypto, r, chg24, near, sweep, ...extra };
}

let sortKey = 'rank', sortDir = 1;
export function renderScreener(rows, cur, onPick, status) {
  const el = $('#scanBody') || $('#tab-screener');
  const rank = x => (x.r.decision !== 'WAIT' ? 0 : x.r.setup !== 'NONE' ? 1 : 2) * 100 - x.r.score;
  const keyFn = {
    rank, asset: x => x.key, chg: x => -(x.chg24 || 0), score: x => -x.r.score, oi: x => -(Math.abs(x.oi4) || 0),
    fund: x => -(Math.abs(x.funding) || 0), near: x => Math.abs(x.near ? x.near.dist : 99),
  };
  const fn = keyFn[sortKey] || rank;
  const sorted = rows.slice().sort((a, b) => sortKey === 'asset' ? sortDir * a.key.localeCompare(b.key) : sortDir * (fn(a) - fn(b)));
  const b = v => v === 1 ? '<span class="up">▲</span>' : v === -1 ? '<span class="dn">▼</span>' : '<span class="muted">•</span>';
  const head = [['asset', 'Asset'], ['', 'Price'], ['chg', '24h'], ['', 'D / 4H'], ['', 'Zone'], ['', 'Setup'], ['score', 'Score'],
    ['', 'Status'], ['oi', 'OI 4h'], ['fund', 'Funding'], ['near', 'Nearest level']];
  el.innerHTML = `<div class="muted" style="margin-bottom:8px">${status || ''}</div>` + (!rows.length ? '<div class="empty">Scanning…</div>' :
    `<div class="tbl-wrap"><table class="t"><thead><tr>${head.map(([k, n]) => `<th data-k="${k}">${n}${k && k === sortKey ? (sortDir > 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>` +
    sorted.map(x => {
      const r = x.r, side = r.lead_long ? 'LONG' : 'SHORT';
      const stTxt = r.decision !== 'WAIT' ? pill(r.decision + ' READY', r.decision === 'LONG' ? 'up' : 'dn')
        : r.setup !== 'NONE' ? pill(side + ' · waiting', 'amber') : '<span class="muted">no setup</span>';
      const zone = r.loc.zone === 'DISCOUNT' ? `<span class="up">Discount</span>` : r.loc.zone === 'PREMIUM' ? `<span class="dn">Premium</span>` : `<span class="muted">${esc(r.loc.zone)}</span>`;
      return `<tr class="click ${x.key === cur ? 'hot' : ''}" data-key="${esc(x.key)}">
        <td class="symc">${logo(x.key, 16)}<b>${esc(x.key)}</b>${x.sweep ? ` <span class="${x.sweep === 'bull' ? 'up' : 'dn'}" title="Liquidity sweep in the last bars">⚡</span>` : ''}</td>
        <td class="num">${fp(r.price)}</td><td class="num ${tone(x.chg24)}">${fpct(x.chg24)}</td>
        <td>${b(r.d_bias)} ${b(r.h_bias)}</td><td>${zone}${r.loc.in_ote_long || r.loc.in_ote_short ? ' · OTE' : ''}</td>
        <td>${r.setup === 'NONE' ? '<span class="muted">—</span>' : esc(r.setup.split(' ')[0])}</td>
        <td class="num">${r.score}/9</td><td>${stTxt}</td>
        <td class="num ${tone(x.oi4)}">${x.isCrypto ? fpct(x.oi4, 1) : '—'}</td>
        <td class="num">${x.isCrypto && isNum(x.funding) ? (x.funding > 0 ? '+' : '') + x.funding.toFixed(4) + '%' : '—'}</td>
        <td>${x.near ? `${esc(x.near.name)} <span class="num ${tone(x.near.dist)}">${fpct(x.near.dist)}</span>` : '—'}</td></tr>`;
    }).join('') + '</tbody></table></div>') +
    '<div class="muted" style="margin-top:6px;font-size:11.5px">Screener reads Binance futures (price, taker CVD, OI, funding) for speed, so its score can differ by a point from the main view, which uses Coinalyze across several exchanges. ⚡ = liquidity sweep. Click a row to open it.</div>';
  el.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
    const k = th.dataset.k; if (!k) return;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    renderScreener(rows, cur, onPick, status);
  });
  el.querySelectorAll('tr[data-key]').forEach(tr => tr.onclick = () => onPick(tr.dataset.key));
}

// ── Setup history ───────────────────────────────────────────
const HKEY = 'lof_history_v1';
export const loadHist = () => { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } };
const saveHist = h => { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(-500))); } catch (e) { /* ignore */ } };

// Record a "trade ready" signal once (same market + side within 2 hours counts as the same signal).
export function recordSignal(key, sym, isCrypto, r, ltf, source) {
  if (r.decision === 'WAIT') return false;
  const side = r.decision, h = loadHist();
  if (h.some(x => x.key === key && x.side === side && r.now - x.t < 7200)) return false;
  h.push({ id: `${key}-${r.now}`, key, sym, crypto: isCrypto, side, setup: r.setup, t: r.now, entry: r.price, sl: r.sl, tp1: r.tp1,
    rr: r.rr, score: r.score, ltf, source, status: 'open' });
  saveHist(h);
  return true;
}

// Check open signals against later 5-minute candles: TP1 first = win, SL first = loss (same candle = loss).
export async function evaluateHistory() {
  const h = loadHist();
  const open = h.filter(x => x.status === 'open');
  if (!open.length) return h;
  const now = Date.now() / 1000;
  for (const x of open) {
    try {
      let bars;
      if (x.crypto) bars = await API.klinesSince(x.sym, '5m', x.t);
      else bars = (await API.yahooRaw(API.TRADFI[x.key].t, '5m', '5d')).bars;
      for (const b of bars) {
        if (b.t <= x.t) continue;
        const long = x.side === 'LONG';
        const hitSL = long ? b.l <= x.sl : b.h >= x.sl, hitTP = long ? b.h >= x.tp1 : b.l <= x.tp1;
        if (hitSL) { x.status = 'loss'; x.closed = b.t; break; }
        if (hitTP) { x.status = 'win'; x.closed = b.t; break; }
      }
      if (x.status === 'open' && now - x.t > 3 * 86400) x.status = 'expired';
    } catch (e) { /* try again later */ }
  }
  saveHist(h);
  return h;
}

export function renderHistory(h, onPick) {
  const el = $('#tab-history');
  const closed = h.filter(x => x.status === 'win' || x.status === 'loss');
  const wins = closed.filter(x => x.status === 'win');
  const R = closed.reduce((a, x) => a + (x.status === 'win' ? (isNum(x.rr) ? x.rr : 0) : -1), 0);
  const by = name => { const c = closed.filter(x => x.setup.startsWith(name)); const w = c.filter(x => x.status === 'win').length; return c.length ? `${w}/${c.length} (${(w / c.length * 100).toFixed(0)}%)` : '—'; };
  el.innerHTML = `<div class="tiles" style="margin-bottom:10px">
      ${tile('Signals', h.length, `${h.filter(x => x.status === 'open').length} open`)}
      ${tile('Win rate (TP1 before SL)', closed.length ? (wins.length / closed.length * 100).toFixed(0) + '%' : '—', `${wins.length} won · ${closed.length - wins.length} lost`)}
      ${tile('Total R', closed.length ? (R > 0 ? '+' : '') + R.toFixed(1) + 'R' : '—', 'win = R:R, loss = −1R', tone(R))}
      ${tile('A sweep', by('A SWEEP'))}${tile('B pullback', by('B PULLBACK'))}${tile('A+', by('A+'))}
    </div>` +
    (!h.length ? '<div class="empty">No signals yet. Every time a market turns LONG or SHORT READY (main view or screener), it is recorded here and checked against later candles.</div>' :
      `<div class="tbl-wrap"><table class="t"><thead><tr><th>Time</th><th>Asset</th><th>Side</th><th>Setup</th><th>Entry</th><th>SL</th><th>TP1</th><th>R:R</th><th>Score</th><th>Result</th></tr></thead><tbody>` +
      h.slice().reverse().slice(0, 100).map(x => `<tr class="click" data-key="${esc(x.key)}"><td>${new Date(x.t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td><b>${esc(x.key)}</b> <span class="muted">${esc(x.ltf)}</span></td><td>${pill(x.side, x.side === 'LONG' ? 'up' : 'dn')}</td><td>${esc(x.setup)}</td>
        <td class="num">${fp(x.entry)}</td><td class="num dn">${fp(x.sl)}</td><td class="num up">${fp(x.tp1)}</td>
        <td class="num">${isNum(x.rr) ? x.rr.toFixed(2) : '—'}</td><td class="num">${x.score}/9</td>
        <td>${x.status === 'win' ? pill('WIN', 'up') : x.status === 'loss' ? pill('LOSS', 'dn') : x.status === 'expired' ? pill('EXPIRED', 'grey') : pill('OPEN', 'blue')}</td></tr>`).join('') +
      '</tbody></table></div>') +
    `<div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button class="btn" id="hExport">Download CSV</button><button class="btn" id="hClear">Clear history</button>
     <span class="muted" style="font-size:11.5px">Saved in this browser. Results are checked on 5-minute candles while the dashboard is open.</span></div>`;
  el.querySelectorAll('tr[data-key]').forEach(tr => tr.onclick = () => onPick(tr.dataset.key));
  $('#hClear').onclick = () => { if (confirm('Delete all recorded signals?')) { saveHist([]); renderHistory([], onPick); } };
  $('#hExport').onclick = () => {
    const cols = ['t', 'key', 'side', 'setup', 'entry', 'sl', 'tp1', 'rr', 'score', 'ltf', 'status', 'closed', 'source'];
    const csv = [cols.join(',')].concat(h.map(x => cols.map(c => c === 't' || c === 'closed' ? (x[c] ? new Date(x[c] * 1000).toISOString() : '') : JSON.stringify(x[c] ?? '')).join(','))).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'lof-setup-history.csv'; a.click();
  };
}

// ── Alerts ──────────────────────────────────────────────────
export async function fireAlert(cfg, tgReady, key, r, ltf) {
  const side = r.decision;
  const text = `<b>${key} · ${side} READY</b>\n${r.setup} · score ${r.score}/9 · ${ltf}\nEntry ${fp(r.price)}\nSL ${fp(r.sl)}\nTP1 ${fp(r.tp1)} · TP2 ${fp(r.tp2)}\nR:R 1:${isNum(r.rr) ? r.rr.toFixed(2) : '—'} · ${r.loc.zone} · session ${r.session}`;
  if (cfg.alerts.browser && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(`${key} · ${side} READY`, { body: `${r.setup} · score ${r.score}/9 · entry ${fp(r.price)} · SL ${fp(r.sl)} · TP1 ${fp(r.tp1)}`, icon: '/favicon.svg', tag: key + side }); } catch (e) { /* ignore */ }
  }
  if (cfg.alerts.telegram && tgReady) {
    try { await API.sendTelegram(text); } catch (e) { toast('Telegram alert failed: ' + esc(e.message)); }
  }
  toast(`🔔 <b>${esc(key)}</b> ${side} READY · ${esc(r.setup)} · ${r.score}/9`, 6000);
}

// ── Market Pulse ────────────────────────────────────────────
const TOP_IDS = ['bitcoin', 'ethereum', 'tether', 'ripple', 'binancecoin', 'solana', 'usd-coin', 'dogecoin', 'tron', 'cardano'];
async function pulseYahoo(key) {
  const def = API.TRADFI[key];
  const [d, h] = await Promise.all([API.yahooRaw(def.t, '1d', '1mo'), API.yahooRaw(def.t, '60m', '5d').catch(() => ({ bars: [] }))]);
  const c = d.bars.map(b => b.c);
  if (c.length < 2) return null;
  const lastV = c[c.length - 1], prev = c[c.length - 2], wk = c.length >= 6 ? c[c.length - 6] : c[0];
  const diff = def.kind === 'yield' ? (a, b) => (a - b) * 100 : (a, b) => (a / b - 1) * 100;
  return { key, label: def.short, kind: def.kind, value: lastV, chg: diff(lastV, prev), chg7: diff(lastV, wk), spark: h.bars.length ? h.bars.map(b => b.c) : c.slice(-7) };
}
export async function loadPulse() {
  const safe = p => p.catch(() => null);
  const [macro, glob, mk, fg, fgs] = await Promise.all([
    Promise.all(API.PULSE_KEYS.map(k => safe(pulseYahoo(k)))),
    safe(API.cg('global')), safe(API.cg('coins/markets', { vs_currency: 'usd', ids: TOP_IDS.join(','), sparkline: 'true' })),
    safe(API.fngCrypto()), safe(API.fngStocks())]);
  let crypto = null, hist = {};
  if (glob && glob.data) {
    const d = glob.data, total = d.total_market_cap && d.total_market_cap.usd, pct = d.market_cap_percentage || {};
    crypto = { total, chg: d.market_cap_change_percentage_24h_usd, btc_d: pct.btc, eth_d: pct.eth, usdt_d: pct.usdt,
      total2: total && pct.btc != null ? total * (1 - pct.btc / 100) : null,
      total3: total && pct.btc != null && pct.eth != null ? total * (1 - (pct.btc + pct.eth) / 100) : null };
    if (Array.isArray(mk)) {
      const series = {};
      mk.forEach(c => {
        const px = (c.sparkline_in_7d || {}).price || [], supply = c.current_price ? (c.market_cap || 0) / c.current_price : 0;
        if (px.length && supply) series[c.id] = px.map(p => p * supply);
      });
      if (series.bitcoin && total) {
        const n = Math.min(...Object.values(series).map(v => v.length));
        Object.keys(series).forEach(k => { series[k] = series[k].slice(-n); });
        const top = new Array(n).fill(0).map((_, i) => Object.values(series).reduce((a, v) => a + v[i], 0));
        const tot = top.map(v => total * v / top[n - 1]);
        const z = new Array(n).fill(0), btc = series.bitcoin, eth = series.ethereum || z, usdt = series.tether || z;
        const H = { total: tot, total2: tot.map((v, i) => v - btc[i]), total3: tot.map((v, i) => v - btc[i] - eth[i]),
          btc_d: tot.map((v, i) => btc[i] / v * 100), eth_d: tot.map((v, i) => eth[i] / v * 100), usdt_d: tot.map((v, i) => usdt[i] / v * 100) };
        const perDay = Math.max(1, Math.floor(n / 7));
        for (const [k, v] of Object.entries(H)) {
          const ch = back => n <= back ? NaN : k.endsWith('_d') ? v[n - 1] - v[n - 1 - back] : (v[n - 1] / v[n - 1 - back] - 1) * 100;
          hist[k] = { spark: v, chg: ch(perDay), chg7: ch(n - 1) };
        }
      }
    }
  }
  let fgc = null, fgsOut = null;
  if (fg && fg.data && fg.data.length) {
    const vals = fg.data.slice().reverse().map(x => +x.value);
    fgc = { value: vals[vals.length - 1], label: fg.data[0].value_classification, spark: vals, chg: vals[vals.length - 1] - vals[vals.length - 2], chg7: vals.length > 7 ? vals[vals.length - 1] - vals[vals.length - 8] : NaN };
  }
  if (fgs && fgs.fear_and_greed) {
    const f = fgs.fear_and_greed, hs = ((fgs.fear_and_greed_historical || {}).data || []).slice(-30).map(p => p.y);
    fgsOut = { value: Math.round(f.score), label: String(f.rating || '').replace(/^\w/, c => c.toUpperCase()), spark: hs,
      chg: f.previous_close != null ? f.score - f.previous_close : NaN, chg7: f.previous_1_week != null ? f.score - f.previous_1_week : NaN };
  }
  return { macro: macro.filter(Boolean), crypto, hist, fgc, fgs: fgsOut };
}

// Compact macro strip at the top of the page (always visible).
export function renderStrip(p, onOpen) {
  const el = $('#strip');
  if (!p) { el.innerHTML = '<div class="s"><div class="l">Market pulse</div><div class="v muted">loading…</div></div>'; return; }
  const ch = (v, sfx) => isNum(v) ? `<span class="c ${tone(v)}">${v > 0 ? '+' : ''}${v.toFixed(2)}${sfx}</span>` : '';
  const item = (label, value, chg, spark, key, up) => `<div class="s ${key ? 'click' : ''}" ${key ? `data-open="${key}" title="Open chart"` : ''}>
    <div class="l">${label}</div><div class="v">${value}${chg || ''}</div>${sparkSvg(spark, up)}</div>`;
  const out = p.macro.map(m => item(m.label, m.kind === 'yield' ? m.value.toFixed(3) + '%' : m.kind === 'ratio' ? m.value.toFixed(5) : m.value.toFixed(2),
    ch(m.chg, m.kind === 'yield' ? 'bp' : '%'), m.spark, m.key));
  if (p.crypto) {
    const H = k => p.hist[k] || {};
    out.push(item('BTC.D', p.crypto.btc_d != null ? p.crypto.btc_d.toFixed(2) + '%' : '—', ch(H('btc_d').chg, ''), H('btc_d').spark));
    out.push(item('ETH.D', p.crypto.eth_d != null ? p.crypto.eth_d.toFixed(2) + '%' : '—', ch(H('eth_d').chg, ''), H('eth_d').spark));
    const us = H('usdt_d').spark;
    out.push(item('USDT.D', p.crypto.usdt_d != null ? p.crypto.usdt_d.toFixed(2) + '%' : '—', ch(H('usdt_d').chg, ''), us, null, us && us.length > 1 ? us[us.length - 1] <= us[0] : null));
    out.push(item('TOTAL', fusd(p.crypto.total), ch(p.crypto.chg, '%'), H('total').spark));
    out.push(item('TOTAL2', fusd(p.crypto.total2), ch(H('total2').chg, '%'), H('total2').spark));
    out.push(item('TOTAL3', fusd(p.crypto.total3), ch(H('total3').chg, '%'), H('total3').spark));
  }
  if (p.fgc) out.push(item('Crypto F&G', `${p.fgc.value} <span style="font-size:10.5px">${esc(p.fgc.label)}</span>`, '', p.fgc.spark));
  if (p.fgs) out.push(item('Stock F&G', `${p.fgs.value} <span style="font-size:10.5px">${esc(p.fgs.label)}</span>`, '', p.fgs.spark));
  el.innerHTML = out.join('') || '<div class="s"><div class="l">Market pulse</div><div class="v muted">unavailable</div></div>';
  el.querySelectorAll('[data-open]').forEach(t => t.onclick = () => onOpen(t.dataset.open));
}

export function renderPulse(p, onOpen) {
  const el = $('#tab-pulse');
  if (!p) { el.innerHTML = '<div class="empty">Loading Market Pulse…</div>'; return; }
  const ch = (v, sfx) => isNum(v) ? `<span class="${tone(v)}">${v > 0 ? '+' : ''}${v.toFixed(2)}${sfx}</span>` : '';
  const pt = (label, value, d1, d7, spark, note, up, key, vcls = '') =>
    `<div class="tile ${key ? 'click' : ''}" ${key ? `data-open="${key}" title="Open full chart"` : ''}><div class="l">${label}</div><div class="v ${vcls}">${value}</div>
     <div class="n">${[d1, d7].filter(Boolean).join(' · ')}</div>${sparkSvg(spark, up)}${note ? `<div class="n">${note}</div>` : ''}</div>`;
  const macro = p.macro.map(m => {
    const val = m.kind === 'yield' ? m.value.toFixed(3) + '%' : m.kind === 'ratio' ? m.value.toFixed(5) : m.value.toFixed(2);
    const sfx = m.kind === 'yield' ? ' bp' : '%';
    return pt(m.label, val, ch(m.chg, sfx + ' 1d'), ch(m.chg7, sfx + ' 7d'), m.spark, '', null, m.key);
  });
  const fgCol = v => v < 25 ? 'dn' : v < 45 ? 'amber' : v <= 55 ? '' : 'up';
  const senti = [];
  if (p.fgc) senti.push(pt('Crypto Fear & Greed', `${p.fgc.value} <span style="font-size:12px">${esc(p.fgc.label)}</span>`, ch(p.fgc.chg, ' 1d'), ch(p.fgc.chg7, ' 7d'), p.fgc.spark, 'alternative.me', null, null, fgCol(p.fgc.value)));
  if (p.fgs) senti.push(pt('Stock Fear & Greed', `${p.fgs.value} <span style="font-size:12px">${esc(p.fgs.label)}</span>`, ch(p.fgs.chg, ' 1d'), ch(p.fgs.chg7, ' 7d'), p.fgs.spark, 'CNN', null, null, fgCol(p.fgs.value)));
  const vix = p.macro.find(m => m.key === 'VIX');
  if (vix) senti.push(pt('VIX regime', vix.value < 15 ? 'calm' : vix.value < 20 ? 'normal' : vix.value < 30 ? 'elevated' : 'fear', '', '', null, '<15 calm · 20+ elevated · 30+ fear', null, null, vix.value < 20 ? 'up' : vix.value < 30 ? 'amber' : 'dn'));
  const crypto = [];
  if (p.crypto) {
    const H = k => p.hist[k] || {};
    [['total', 'Crypto market cap'], ['total2', 'TOTAL2 (ex BTC)'], ['total3', 'TOTAL3 (ex BTC, ETH)']].forEach(([k, l]) =>
      crypto.push(pt(l, fusd(p.crypto[k]), ch(k === 'total' ? p.crypto.chg : H(k).chg, '% 24h'), ch(H(k).chg7, '% 7d'), H(k).spark)));
    [['btc_d', 'BTC dominance'], ['eth_d', 'ETH dominance'], ['usdt_d', 'USDT dominance', 'up = risk-off']].forEach(([k, l, note]) => {
      if (p.crypto[k] == null) return;
      const s = H(k).spark; const up = k === 'usdt_d' && s && s.length > 1 ? s[s.length - 1] <= s[0] : null;
      crypto.push(pt(l, p.crypto[k].toFixed(2) + '%', ch(H(k).chg, ' pts 24h'), ch(H(k).chg7, ' pts 7d'), s, note, up));
    });
  }
  // macro and crypto market tiles now live in the Main watchlist; this tab keeps sentiment only
  void macro; void crypto;
  el.innerHTML = `<div class="pulse-h">Sentiment</div><div class="tiles">${senti.join('') || '<div class="muted">Unavailable</div>'}</div>
    <div class="muted" style="margin-top:8px;font-size:11.5px">Fear &amp; Greed: alternative.me (crypto), CNN (stocks) · VIX: Yahoo Finance. DXY, yields, oil, dominance and TOTAL are in your Main watchlist. Refreshes every 5 minutes.</div>`;
  el.querySelectorAll('[data-open]').forEach(t => t.onclick = () => onOpen(t.dataset.open));
}

// ── Killzone clock + news ───────────────────────────────────
const KZ = [['Asia', 20 * 60, 24 * 60], ['London KZ', 2 * 60, 5 * 60], ['NY KZ', 7 * 60, 10 * 60]];
export function updateClock() {
  const now = Date.now() / 1000, m = nyMinutes(now), p = nyParts(now);
  const cur = KZ.find(([, a, b]) => m >= a && m < b);
  const el = $('#kz');
  const nyT = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')} NY`;
  if (cur) {
    el.className = 'kz live';
    el.innerHTML = `<span class="up">●</span> <b>${cur[0]}</b> · ${dur((cur[2] - m) * 60)} left · <span class="muted">${nyT}</span>`;
  } else {
    let best = null;
    KZ.forEach(([n, a]) => { const d = (a - m + 1440) % 1440; if (!best || d < best[1]) best = [n, d]; });
    el.className = 'kz';
    el.innerHTML = `Next <b>${best[0]}</b> in ${dur(best[1] * 60)} · <span class="muted">${nyT}</span>`;
  }
}

let newsCache = null, chartNews = [];
const SHORT = [[/FOMC|Federal Funds|Fed Chair|Powell/i, 'FOMC'], [/Core CPI/i, 'Core CPI'], [/CPI/i, 'CPI'], [/Core PPI/i, 'Core PPI'], [/PPI/i, 'PPI'],
  [/Non-Farm|NFP/i, 'NFP'], [/Unemployment Rate/i, 'Unemployment'], [/Core PCE/i, 'Core PCE'], [/PCE/i, 'PCE'], [/GDP/i, 'GDP'],
  [/Retail Sales/i, 'Retail Sales'], [/ISM/i, 'ISM'], [/JOLTS/i, 'JOLTS'], [/Jobless Claims/i, 'Jobless Claims'], [/ADP/i, 'ADP']];
const shortName = t => { const m = SHORT.find(([re]) => re.test(t)); return m ? m[1] : t.split(' ').slice(0, 2).join(' '); };
export const newsForChart = () => chartNews;
export async function loadNews() {
  try {
    const all = (await API.calendar()).filter(e => e.country === 'USD' && (e.impact === 'High' || e.impact === 'Medium'))
      .map(e => ({ title: e.title, short: shortName(e.title), impact: e.impact, t: Date.parse(e.date) / 1000, forecast: e.forecast, previous: e.previous }));
    newsCache = all.filter(e => e.impact === 'High');
    // one marker per time slot; high impact first
    const byT = new Map();
    all.sort((a, b) => (a.impact === 'High' ? 0 : 1) - (b.impact === 'High' ? 0 : 1)).forEach(e => { if (!byT.has(e.t)) byT.set(e.t, e); else if (byT.get(e.t).short !== e.short && e.impact === 'High') byT.get(e.t).short += ' · ' + e.short; });
    chartNews = [...byT.values()].filter(e => e.impact === 'High' || /PPI|CPI|PCE|GDP|ISM|Retail|JOLTS|Claims|ADP/.test(e.short)).sort((a, b) => a.t - b.t);
  } catch (e) { newsCache = null; chartNews = []; }
  updateNews();
  if (typeof window.__onNews === 'function') window.__onNews();
}
let newsTz = 'local';
export function updateNews(tz) {
  if (tz) newsTz = tz;
  const el = $('#news');
  if (!newsCache) { el.innerHTML = '<span class="muted">News: unavailable</span>'; return; }
  const now = Date.now() / 1000;
  const recent = newsCache.find(e => now >= e.t && now - e.t < 15 * 60);
  const next = newsCache.filter(e => e.t > now).sort((a, b) => a.t - b.t)[0];
  el.classList.toggle('soon', !!(recent || (next && next.t - now < 3600)));
  if (recent) el.innerHTML = `<span class="dn">●</span> <b>${esc(recent.title)}</b> just released`;
  else if (next) el.innerHTML = `📅 <b>${esc(next.title)}</b> in ${dur(next.t - now)}`;
  else el.innerHTML = '<span class="muted">No more high-impact USD news this week</span>';
  el.title = `High-impact USD news this week (Forex Factory, ${newsTz === 'local' ? 'your local time' : newsTz}). Full list: Calendar tab.\n` + newsCache.map(e =>
    `${new Date(e.t * 1000).toLocaleString('en-GB', { timeZone: newsTz === 'local' ? undefined : newsTz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · ${e.title}${e.forecast ? ' · f ' + e.forecast : ''}${e.previous ? ' · p ' + e.previous : ''}`).join('\n');
}
