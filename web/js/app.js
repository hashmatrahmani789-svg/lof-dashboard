// LOF Dashboard — main app.
import * as API from './data.js';
import { analyze, perfFromDaily, isNum, nyParts } from './engine.js';
import { buildChart, abbr, tzOffset, DEFAULT_COLORS, COLOR_NAMES } from './chart.js';
import { createMini } from './multichart.js';
import { logo, loadLogos, onLogos } from './logos.js';
import { createWatchlist } from './watchlist.js';
import { createAlerts } from './pricealerts.js';
import { createClock, createCalendar, fmtTime } from './clock.js';
import * as UI from './ui.js';
import * as X from './extras.js';

const { $, esc, toast } = UI;

// ── settings ────────────────────────────────────────────────
const OPENS = [['Daily open', 'd_open', '#e0e0e0'], ['NY midnight', 'ny_mid', '#00bcd4'], ['London open', 'ldn_open', '#5b7fff'],
  ['NY open', 'ny_open', '#ff9800'], ['Weekly open', 'w_open', '#ce93d8'], ['Monthly open', 'm_open', '#8d6e63']];
const LINE_LAYERS = ['EMA 12', 'EMA 21', 'EMA 50', 'Impulse candles', 'Volume MA', 'Levels', 'Value areas (VAH / VAL)', ...OPENS.map(o => o[0]), 'Trade plan'];
const ZONE_LAYERS = ['Asia range', 'Sessions', 'Session highs / lows', 'Liquidity: equal highs / lows', 'Liquidity: swing highs / lows', 'Fair value gaps', 'VP prev 4H', 'VP visible range', 'News (CPI, FOMC…)'];
const OPEN_SHORT = { d_open: 'DO', ny_mid: 'NYM', ldn_open: 'LO', ny_open: 'NO', w_open: 'WO', m_open: 'MO' };
const HIST_ROWS = [['d_open', 'Daily opens'], ['w_open', 'Weekly opens'], ['m_open', 'Monthly opens'], ['ny_mid', 'NY midnight opens'],
  ['ldn_open', 'London opens'], ['ny_open', 'NY opens'], ['pdhl', 'Previous day highs / lows'], ['pwhl', 'Previous week highs / lows']];
const IND_ROWS = [['st', 'Supertrend'], ['tema15', 'TEMA 15'], ['tema30', 'TEMA 30'], ['ema200', 'EMA 200'], ['vwapD', 'VWAP (day)'], ['vwapW', 'VWAP (week)'],
  ['vwapS', 'Anchored VWAP (swing high / low)'], ['rsi', 'RSI'], ['rsiDiv', 'RSI divergences'], ['macd', 'MACD'], ['macdCross', 'MACD cross arrows'], ['atr', 'ATR']];
const PANES = [['oi', 'OI'], ['perp', 'Perp CVD'], ['spot', 'Spot CVD'], ['cvd2', 'Perp vs spot CVD'], ['vol', 'Volume'],
  ['liq', 'Liquidations'], ['cbp', 'Coinbase premium'], ['fng', 'Fear & Greed']];
const SIZES = { S: 380, M: 520, L: 700, XL: 900 };
const IMP_DEFAULT = [{ len: 10, size: 1.5, vol: 1.5, ratio: 0.7, on: true }, { len: 14, size: 2, vol: 2, ratio: 0.6, on: true }, { len: 20, size: 2.5, vol: 3, ratio: 0.5, on: true }];
const TFS = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1D', '1W', '1M'];
const HOT = TFS.slice(1, 10);                     // keys 1–9: 5m … 1W
const TF_LABEL = { '1D': 'D', '1W': 'W', '1M': 'M' };
const CHART_TYPES = [['candles', 'Candles'], ['hollow', 'Hollow candles'], ['bars', 'Bars'], ['line', 'Line'], ['area', 'Area'], ['heikin', 'Heikin Ashi']];
const DEFAULTS = {
  asset: 'BTC', ltf: '15m', tf: '15m',
  lines: ['EMA 12', 'EMA 21', 'EMA 50', 'Impulse candles', 'Volume MA', 'Levels', 'Value areas (VAH / VAL)', 'Daily open', 'NY midnight', 'London open', 'NY open', 'Weekly open', 'Trade plan'],
  zones: ['Asia range', 'Sessions', 'VP prev 4H', 'News (CPI, FOMC…)'],
  panes: ['oi', 'cvd2', 'vol'], size: 'M', impulse: 'Normal',
  watch: ['BTC', 'ETH', 'SOL', 'GOLD', 'SILVER', 'SPX', 'NDX'],
  params: { piv: 3, valid: 20, minRR: 2, minScore: 7 },
  alerts: { browser: false, telegram: false }, cgId: {}, theme: 'dark', oiMarkets: 12,
  tz: 'local', chartType: 'candles', scaleMode: 'normal', cal: { cur: 'usd', imp: 'med' },
  colors: {}, ind: { st: false, stLen: 10, stMult: 3, tema15: false, tema30: false, ema200: false, vwapD: false, vwapW: false, vwapS: false, rsi: false, rsiLen: 14, rsiDiv: true, macd: false, macdFast: 12, macdSlow: 26, macdSig: 9, macdCross: false, atr: false, atrLen: 14 },
  hist: { d_open: 1, w_open: 1, m_open: 1, ny_mid: 1, ldn_open: 1, ny_open: 1, pdhl: 1, pwhl: 1 },
  layout: 1, cells: [{ coin: 'ETH', tf: '1h' }, { coin: 'SOL', tf: '15m' }, { coin: 'BTC', tf: '4h' }],
};
const CFG_KEY = 'lof_cfg_v2';
const VERSION = 'v8.13';
const METALS = { GOLD: 'XAU', SILVER: 'XAG' };
const METALS_NAME = { GOLD: 'Gold', SILVER: 'Silver' };
let cfg;
try { cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { cfg = Object.assign({}, DEFAULTS); }
cfg.params = Object.assign({}, DEFAULTS.params, cfg.params);
cfg.alerts = Object.assign({}, DEFAULTS.alerts, cfg.alerts);
cfg.cal = Object.assign({}, DEFAULTS.cal, cfg.cal);
cfg.ind = Object.assign({}, DEFAULTS.ind, cfg.ind);
if (!Array.isArray(cfg.impDet) || cfg.impDet.length !== 3) cfg.impDet = JSON.parse(JSON.stringify(IMP_DEFAULT));
if (cfg.impHollow == null) cfg.impHollow = true;
if (!cfg.seenImp3) { ['imp1', 'imp2', 'imp3'].forEach(k => delete cfg.colors[k]); cfg.seenImp3 = true; }
cfg.hist = Object.assign({}, DEFAULTS.hist, cfg.hist);
cfg.colors = Object.assign({}, cfg.colors);
// v8.5: previous day / week profiles replaced by the levels (now with VAH / VAL) and the previous 4H profile
if (!cfg.seenV85) {
  cfg.zones = cfg.zones.filter(z => z !== 'VP prev day' && z !== 'VP prev week');
  if (!cfg.zones.includes('VP prev 4H')) cfg.zones.push('VP prev 4H');
  if (cfg.lines.includes('Levels') && !cfg.lines.includes('Value areas (VAH / VAL)')) cfg.lines.push('Value areas (VAH / VAL)');
  cfg.seenV85 = true;
}
if (!cfg.seenLiq) { ['Liquidity: equal highs / lows', 'Liquidity: swing highs / lows'].forEach(z => { if (!cfg.zones.includes(z)) cfg.zones.push(z); }); cfg.seenLiq = true; }
if (!cfg.seenNews) { if (!cfg.zones.includes('News (CPI, FOMC…)')) cfg.zones = cfg.zones.concat(['News (CPI, FOMC…)']); cfg.seenNews = true; }
const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } };

// ── state ───────────────────────────────────────────────────
const S = {
  symbols: [], byBase: {}, gen: 0, timers: [], chartTimers: [], chart: null, ws: null,
  asset: null, tradfi: false, sym: '', base: '', ticker: '', prec: 2, title: '', sub: '',
  bars: {}, chartBars: [], flow: null, flowChart: null, cbp: null, cbOk: null, r: null, ov: undefined, chg24: NaN, perf: null,
  manual: false, wsState: 'starting', lastTick: 0, priceErr: null, server: null, scan: [], scanAt: 0, alerted: {},
};
try { S.alerted = JSON.parse(localStorage.getItem('lof_alerted') || '{}'); } catch (e) { S.alerted = {}; }
const st = () => ({ tradfi: S.tradfi, logo: S.asset ? logo(S.asset, 26) : '', title: S.title, sub: S.sub, price: S.r ? S.r.price : (S.chartBars.length ? S.chartBars[S.chartBars.length - 1].c : NaN),
  prec: S.prec, chg24: S.chg24, ltf: cfg.ltf, params: Object.assign({}, cfg.params, { manual: S.manual }), perf: S.perf,
  sym: S.sym, base: S.base, ticker: S.ticker });
const every = (fn, ms, list = S.timers) => list.push(setInterval(fn, ms));
const clearTimers = list => { list.forEach(clearInterval); list.length = 0; };
const isCryptoKey = k => !API.TRADFI[k] && !!S.byBase[k];
let WL = null, AL = null, CAL = null;
const watchKeys = () => (WL ? WL.keys() : cfg.watch).filter(k => API.TRADFI[k] || S.byBase[k] || !S.symbols.length);

// ── search ──────────────────────────────────────────────────
function allAssets() {
  const metals = Object.keys(METALS).filter(k => S.byBase[k] && S.byBase[k].metal).map(k => ({ key: k, label: `${S.byBase[k].sym} · Binance live`, kind: 'Gold & silver' }));
  return metals.concat(Object.keys(API.TRADFI).map(k => ({ key: k, label: API.TRADFI[k].name, kind: 'Macro / futures' }))
    .concat(S.symbols.map(s => ({ key: s.base, label: s.sym, kind: 'Binance perp' }))));
}
let qSel = 0, qItems = [];
function renderSearch() {
  const v = $('#q').value.trim().toUpperCase(), box = $('#qres');
  if (!v) { box.classList.remove('open'); return; }
  const seen = new Set();
  qItems = allAssets().filter(a => {
    if (seen.has(a.key)) return false;
    const ok = a.key.startsWith(v) || a.key.replace(/^1000+/, '').startsWith(v) || a.label.toUpperCase().includes(v);
    if (ok) seen.add(a.key); return ok;
  }).sort((a, b) => (a.key === v ? -1 : 0) - (b.key === v ? -1 : 0) || a.key.length - b.key.length).slice(0, 30);
  qSel = Math.min(qSel, Math.max(0, qItems.length - 1));
  box.innerHTML = qItems.length ? qItems.map((a, i) => `<div class="it ${i === qSel ? 'sel' : ''}" data-k="${esc(a.key)}"><span class="symc">${logo(a.key, 16)}<b>${esc(a.key)}</b> <small>${esc(a.label)}</small></span><small>${a.kind}</small></div>`).join('')
    : '<div class="it"><small>No match</small></div>';
  box.classList.add('open');
  box.querySelectorAll('[data-k]').forEach(d => d.onmousedown = e => { e.preventDefault(); pick(d.dataset.k); });
}
function pick(k) { $('#q').value = ''; $('#qres').classList.remove('open'); $('#q').blur(); loadAsset(k); }
$('#q').addEventListener('input', () => { qSel = 0; renderSearch(); });
$('#q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { qSel = Math.min(qSel + 1, qItems.length - 1); renderSearch(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { qSel = Math.max(qSel - 1, 0); renderSearch(); e.preventDefault(); }
  else if (e.key === 'Enter' && qItems[qSel]) pick(qItems[qSel].key);
  else if (e.key === 'Escape') { $('#q').value = ''; renderSearch(); $('#q').blur(); }
});
$('#q').addEventListener('blur', () => setTimeout(() => $('#qres').classList.remove('open'), 150));

// hotkeys: / search · 1–9 timeframe · F full screen
window.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (/^[1-9]$/.test(e.key)) setTf(HOT[+e.key - 1]);
  else if (e.key === 'f' || e.key === 'F') { if (S.chart) S.chart.fullscreen(); }
});

// ── quick chips (watchlist) ─────────────────────────────────
function renderQuick() {
  const byKey = Object.fromEntries(S.scan.map(x => [x.key, x]));
  $('#quick').innerHTML = watchKeys().map(k => {
    const x = byKey[k], c = x ? x.chg24 : NaN, dot = x && x.r.decision !== 'WAIT' ? (x.r.decision === 'LONG' ? '🟢 ' : '🔴 ') : '';
    return `<span class="chip ${k === S.asset ? 'on' : ''}" data-k="${esc(k)}">${dot}${logo(k, 15)}${esc(API.TRADFI[k] ? API.TRADFI[k].short : (METALS_NAME[k] || k))}${isNum(c) ? `<span class="d ${UI.tone(c)}">${UI.fpct(c, 1)}</span>` : ''}</span>`;
  }).join('');
  $('#quick').querySelectorAll('[data-k]').forEach(el => el.onclick = () => loadAsset(el.dataset.k));
}

// ── status light ────────────────────────────────────────────
function updateStatus() {
  const now = Date.now() / 1000, el = $('#status'), dot = el.querySelector('.dot'), txt = el.querySelector('.txt');
  const tickAge = S.lastTick ? now - S.lastTick : Infinity;
  const flowAge = S.flow && !S.flow.error ? now - S.flow.at : Infinity;
  let c = 'g', label = 'Live';
  if (S.priceErr) { c = 'r'; label = 'Price error'; }
  else if (S.tradfi) { c = tickAge < 120 ? 'g' : 'y'; label = tickAge < 120 ? 'Updated' : 'Stale'; }
  else if (S.wsState !== 'live' && S.wsState !== 'polling') { c = 'y'; label = S.wsState === 'reconnecting' ? 'Reconnecting' : 'Connecting'; }
  else if (tickAge > 20) { c = 'y'; label = 'No ticks'; }
  else if (S.wsState === 'polling') label = 'Live · 2s';
  else if (S.metal) { /* gold / silver: price only */ }
  else if (S.flow && S.flow.error) { c = 'y'; label = 'Flow error'; }
  else if (flowAge > 240) { c = 'y'; label = S.flow ? 'Flow stale' : 'Loading flow'; }
  dot.className = 'dot ' + c; txt.textContent = label;
  const lines = [];
  lines.push(S.tradfi ? `<b>Price:</b> Yahoo Finance (${esc(S.ticker)}) · polled every 30s · last update ${UI.ago(tickAge)} ago`
    : `<b>Price:</b> Binance futures · ${S.wsState === 'polling' ? 'updating every 2 s (websocket blocked on this network)' : S.wsState === 'live' ? 'live websocket' : S.wsState} · last update ${UI.ago(tickAge)} ago`);
  if (S.priceErr) lines.push(`<span class="dn">${esc(S.priceErr)}</span>`);
  if (S.metal) lines.push('<b>Order flow:</b> not used for gold / silver (price only)');
  else if (!S.tradfi) lines.push(S.flow && S.flow.error ? `<b>Order flow:</b> <span class="dn">${esc(S.flow.error)}</span>` :
    `<b>Order flow:</b> Coinalyze · updated ${UI.ago(flowAge)} ago · refreshes every 60s${S.flow && S.flow.calls != null ? ` · calls ${S.flow.calls}/40 per min` : ''}`);
  lines.push(`<b>Version:</b> ${VERSION}`);
  lines.push(`<b>Screener:</b> ${S.scanAt ? 'scanned ' + UI.ago(now - S.scanAt) + ' ago' : 'starting'} · every 3 min`);
  if (S.server) lines.push(`<b>Telegram:</b> ${S.server.telegram ? 'set up' : 'not set up'} · <b>Notion:</b> ${S.server.notion ? 'set up' : 'not set up'}`);
  el.querySelector('.tip').innerHTML = lines.join('<br>');
}

// ── chart building ──────────────────────────────────────────
// past opens (for "how many" > 1): from 30-minute candles (intraday opens) and daily candles (weekly / monthly)
const DAYS = 86400, wkOf = t => Math.floor((t / DAYS + 3) / 7), moOf = t => { const d = new Date(t * 1000); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
function openPoints(k, B) {
  const m30 = B.m30 || [], d = B.daily || [];
  const change = (arr, f) => arr.filter((b, i) => i > 0 && f(b.t) !== f(arr[i - 1].t));
  let pts = [];
  if (k === 'd_open') pts = m30.length ? m30.filter(b => b.t % DAYS === 0) : d;
  else if (k === 'w_open') pts = change(d, wkOf);
  else if (k === 'm_open') pts = change(d, moOf);
  else { const [h, mi] = { ny_mid: [0, 0], ldn_open: [3, 0], ny_open: [8, 30] }[k]; pts = m30.filter(b => { const p = nyParts(b.t); return p.h === h && p.mi === mi; }); }
  return pts.map(b => ({ time: b.t, price: b.o }));
}
const openColor = (k, c) => cfg.colors['op_' + k] || c;
function overlays(r, B = S.bars) {
  if (!r) return { opens: [], plan: [], levels: [], asia: null, profiles: {} };
  const lines = cfg.lines, opens = [];
  OPENS.forEach(([n, k, c]) => {
    if (!lines.includes(n) || !r.opens[k]) return;
    const cur = r.opens[k], col = openColor(k, c), want = Math.max(1, Math.min(10, cfg.hist[k] || 1));
    if (want > 1) {
      const old = openPoints(k, B || {}).filter(p => p.time < cur.time).slice(-(want - 1));
      old.forEach((p, j) => opens.push({ title: `${OPEN_SHORT[k]}-${old.length - j}`, price: p.price, time: p.time, end: j + 1 < old.length ? old[j + 1].time : cur.time, color: col }));
    }
    opens.push({ title: OPEN_SHORT[k], price: cur.price, time: cur.time, color: col });
  });
  const VA = lines.includes('Value areas (VAH / VAL)');
  const levels = !lines.includes('Levels') ? [] : [['pwh', '#ef5350', 'PWH'], ['pdh', '#ef5350', 'PDH'], ['pd_poc', '#f9a825', 'PDPOC'],
    ['pw_poc', '#ab47bc', 'PWPOC'], ['pdl', '#26a69a', 'PDL'], ['pwl', '#26a69a', 'PWL']]
    .concat(VA ? [['pd_vah', '#9598a1', 'PDVAH'], ['pd_val', '#9598a1', 'PDVAL'], ['pw_vah', '#ce93d8', 'PWVAH'], ['pw_val', '#ce93d8', 'PWVAL']] : [])
    .filter(([k]) => isNum(r.levels[k])).map(([k, c, t]) => ({ price: r.levels[k], color: c, title: t, time: r.level_t ? r.level_t[k] : null }));
  // older previous-day / previous-week highs and lows: each shown during the day (week) after it
  const d = (B && B.daily) || [];
  if (lines.includes('Levels') && d.length > 3) {
    const nD = Math.min(10, cfg.hist.pdhl || 1) - 1;
    for (let k = 0; k < nD; k++) {
      const j = d.length - 3 - k; if (j < 0) break;               // d[last] = today, d[last-1] = yesterday (the current PDH/PDL)
      levels.push({ price: d[j].h, color: '#ef5350', title: `PDH-${k + 1}`, time: d[j + 1].t, end: d[j + 2].t });
      levels.push({ price: d[j].l, color: '#26a69a', title: `PDL-${k + 1}`, time: d[j + 1].t, end: d[j + 2].t });
    }
    const nW = Math.min(10, cfg.hist.pwhl || 1) - 1;
    if (nW > 0) {
      const weeks = [];
      d.forEach(b => { const w = wkOf(b.t), g = weeks[weeks.length - 1]; if (g && g.w === w) { g.h = Math.max(g.h, b.h); g.l = Math.min(g.l, b.l); } else weeks.push({ w, t: b.t, h: b.h, l: b.l }); });
      for (let k = 0; k < nW; k++) {
        const j = weeks.length - 3 - k; if (j < 0) break;
        levels.push({ price: weeks[j].h, color: '#ef5350', title: `PWH-${k + 1}`, time: weeks[j + 1].t, end: weeks[j + 2].t });
        levels.push({ price: weeks[j].l, color: '#26a69a', title: `PWL-${k + 1}`, time: weeks[j + 1].t, end: weeks[j + 2].t });
      }
    }
  }
  const plan = !lines.includes('Trade plan') || r.setup === 'NONE' ? [] :
    [['Entry', r.price, '#d1d4dc'], ['SL', r.sl, '#ef5350'], ['TP1', r.tp1, '#26a69a'], ['TP2', r.tp2, '#26a69a']]
      .filter(x => isNum(x[1])).map(([t, p, c]) => ({ title: t, price: p, color: c }));
  return { opens, plan, levels, asia: r.asia, profiles: r.profiles, news: X.newsForChart() };
}

function chartPanes() {
  const keys = S.tradfi || !API.CZ_TFS.has(cfg.tf) ? cfg.panes.filter(k => k === 'vol' || k === 'fng') : cfg.panes;
  const out = [];
  PANES.forEach(([k, name]) => {
    if (!keys.includes(k)) return;
    if (k === 'oi') out.push({ key: k, series: [{ kind: 'candle', name: 'OI (USD)', color: '#f9a825', data: [] }] });
    if (k === 'perp') out.push({ key: k, series: [{ kind: 'line', name: 'Perp CVD', color: '#ef5350', data: [], cvd: true }] });
    if (k === 'spot') out.push({ key: k, series: [{ kind: 'line', name: 'Spot CVD', color: '#26a69a', data: [], cvd: true }] });
    if (k === 'cvd2') out.push({ key: k, series: [{ kind: 'line', name: 'Perp CVD', color: '#ef5350', data: [], cvd: true },
      { kind: 'line', name: 'Spot CVD', color: '#26a69a', data: [], cvd: true, scale: 'spotcvd' }] });
    if (k === 'vol') {
      const s = [{ kind: 'hist', name: S.tradfi ? 'Volume' : 'Volume (USD)', color: '#787b86', data: [] }];
      if (cfg.lines.includes('Volume MA')) s.push({ kind: 'line', name: 'Vol MA 20', color: '#f9a825', data: [] });
      out.push({ key: k, series: s });
    }
    if (k === 'liq') out.push({ key: k, series: [{ kind: 'hist', name: 'Long liqs', color: '#ef5350', data: [] }, { kind: 'hist', name: 'Short liqs', color: '#26a69a', data: [] }] });
    if (k === 'fng') out.push({ key: k, series: [{ kind: 'line', name: 'Fear & Greed', color: '#f9a825', data: [], fmt: v => v.toFixed(0), minMove: 1 }] });
    if (k === 'cbp') out.push({ key: k, series: [{ kind: 'hist', name: 'Coinbase premium %', color: '#f9a825', data: [], fmt: v => v.toFixed(3) + '%', minMove: 0.001 }] });
  });
  return out;
}

// Higher chart timeframes (up to 4h) are built from the entry-timeframe order flow, so they cost no extra Coinalyze calls.
const canResample = (tf, ltf) => API.TF_SEC[tf] > API.TF_SEC[ltf] && API.TF_SEC[tf] % API.TF_SEC[ltf] === 0 && API.TF_SEC[tf] <= 14400;
function resampleFlow(f, sec) {
  if (!f || f.error) return f;
  const bucket = t => Math.floor(t / sec) * sec;
  const sumRows = rows => { const m = new Map(); (rows || []).forEach(r => { const k = bucket(r[0]), c = m.get(k); if (c) { for (let i = 1; i < r.length; i++) c[i] += r[i]; } else m.set(k, [k, ...r.slice(1)]); }); return [...m.values()]; };
  const oi = new Map();
  (f.oi || []).forEach(r => { const k = bucket(r[0]), c = oi.get(k); if (c) { c[2] = Math.max(c[2], r[2]); c[3] = Math.min(c[3], r[3]); c[4] = r[4]; } else oi.set(k, [k, r[1], r[2], r[3], r[4]]); });
  return Object.assign({}, f, { oi: [...oi.values()], perp: sumRows(f.perp), spot: sumRows(f.spot), liq: f.liq ? sumRows(f.liq) : undefined });
}
function chartFlow() {
  if (S.tradfi || !API.CZ_TFS.has(cfg.tf)) return null;
  if (cfg.tf === cfg.ltf) return S.flow;
  if (canResample(cfg.tf, cfg.ltf)) return resampleFlow(S.flow, API.TF_SEC[cfg.tf]);
  return S.flowChart;
}

function fillPanes() {
  const ch = S.chart; if (!ch) return;
  const bars = S.chartBars, t0 = bars.length ? bars[0].t : 0;
  if (ch.hasPane('vol')) {
    const v = bars.map(b => ({ time: b.t, value: b.v || 0, color: b.c >= b.o ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)' }));
    ch.setPane('vol', 0, v);
    const ma = [];
    for (let i = 19; i < v.length; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += v[j].value; ma.push({ time: v[i].time, value: s / 20 }); }
    ch.setPane('vol', 1, ma);
  }
  const f = chartFlow();
  if (f && !f.error) {
    const after = rows => (rows || []).filter(r => r[0] >= t0);
    ch.setPane('oi', 0, after(f.oi).map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] })));
    const perp = after(f.perp).map(r => ({ time: r[0], value: r[1] })), spot = after(f.spot).map(r => ({ time: r[0], value: r[1] }));
    ch.setPane('perp', 0, perp); ch.setPane('spot', 0, spot); ch.setPane('cvd2', 0, perp); ch.setPane('cvd2', 1, spot);
    if (f.liq) {
      ch.setPane('liq', 0, after(f.liq).map(r => ({ time: r[0], value: -r[1], color: '#ef5350' })));
      ch.setPane('liq', 1, after(f.liq).map(r => ({ time: r[0], value: r[2], color: '#26a69a' })));
    }
  }
  if (S.fng && ch.hasPane('fng')) {
    // daily index shown as a step line on any timeframe
    const pts = [], days = S.fng;
    let j = 0;
    bars.forEach(b => { while (j + 1 < days.length && days[j + 1].t <= b.t) j++; if (days[j] && days[j].t <= b.t) pts.push({ time: b.t, value: days[j].v }); });
    ch.setPane('fng', 0, pts);
  }
  if (S.cbp) ch.setPane('cbp', 0, S.cbp.filter(p => p.time >= t0).map(p => Object.assign({}, p, { color: p.value >= 0 ? '#26a69a' : '#ef5350' })));
}

function chartHeight(nPanes) {
  const base = Math.min(SIZES[cfg.size] || 520, Math.max(320, window.innerHeight * (window.innerWidth < 700 ? 0.55 : 0.8)));
  return Math.round(base + base * 0.3 * nPanes);
}

function layersObj() {
  const L = cfg.lines, Z = cfg.zones;
  return { ema12: L.includes('EMA 12'), ema21: L.includes('EMA 21'), ema50: L.includes('EMA 50'), impulse: L.includes('Impulse candles'),
    asia: Z.includes('Asia range'), sessions: Z.includes('Sessions'), vp4h: Z.includes('VP prev 4H'),
    vp_visible: Z.includes('VP visible range'), news: Z.includes('News (CPI, FOMC…)'), fvg: Z.includes('Fair value gaps'), sesshl: Z.includes('Session highs / lows'),
    liqEq: Z.includes('Liquidity: equal highs / lows'), liqSwing: Z.includes('Liquidity: swing highs / lows') };
}
const chartOpts = () => ({ theme: cfg.theme, tz: cfg.tz, chartType: cfg.chartType, colors: cfg.colors, ind: cfg.ind, impDet: cfg.impDet, impHollow: cfg.impHollow,
  layers: layersObj(), lines: cfg.lines, panes: cfg.panes });
// alert actions from any chart: add (Alt+A, right-click, 🔔 on a line), move (drag), edit, delete
const alertHooks = (key, sym, tradfi, prec) => ({
  onAddAlert: a => AL && AL.open(Object.assign({ key, sym, tradfi, prec }, a)),
  onMoveAlert: (id, patch) => AL && AL.move(id, patch),
  onDeleteAlert: id => AL && AL.remove(id),
  onEditAlert: id => AL && AL.edit(id),
});

// ── multi-chart layout (1, 2 or 4 charts) ──
const MINIS = [];
function sizeGrid(nPanes) {
  const g = $('#chartGrid'), n = cfg.layout, stacked = window.innerWidth < 900;
  g.className = 'chart-grid l' + n + (stacked ? ' stacked' : '');
  const h = chartHeight(nPanes);
  if (n === 1) { g.style.height = ''; $('#chart').style.height = h + 'px'; return; }
  if (stacked) { g.style.height = ''; $('#chart').style.height = h + 'px'; g.querySelectorAll('.cell.mini').forEach(c => { c.style.height = '460px'; }); return; }
  g.style.height = (n === 2 ? h : Math.max(760, h)) + 'px'; $('#chart').style.height = '';
  g.querySelectorAll('.cell.mini').forEach(c => { c.style.height = ''; });
}
function setupMinis() {
  const want = cfg.layout - 1, g = $('#chartGrid');
  while (MINIS.length > want) { const m = MINIS.pop(); m.destroy(); m.cell.remove(); }
  while (MINIS.length < want) {
    const i = MINIS.length, cell = document.createElement('div');
    cell.className = 'cell mini'; g.appendChild(cell);
    const init = cfg.cells[i] || { coin: 'BTC', tf: '1h' };
    const m = createMini(cell, init, {
      byBase: () => S.byBase, tfs: TFS, tfLabel: t => TF_LABEL[t] || t, chartOpts, overlays, params: () => cfg.params,
      alertsFor: k => (AL ? AL.forKey(k) : []), alertHooks, feed: (k, p) => AL && AL.feed(k, p),
      onDrawingsSaved: (coin, shapes) => pushDrawings(coin, shapes), onOpenMain: k => loadAsset(k),
      onChange: st2 => { cfg.cells[i] = st2; saveCfg(); },
    });
    m.cell = cell; MINIS.push(m);
  }
  sizeGrid(chartPanes().length);
}
const rebuildMinis = () => MINIS.forEach(m => m.rebuild());

function buildChartNow() {
  if (S.chart) { S.chart.destroy(); S.chart = null; }
  const host = $('#chart');
  if (!S.chartBars.length) { host.innerHTML = '<div class="loading">No price data for this timeframe.</div>'; return; }
  const panes = chartPanes();
  sizeGrid(panes.length);
  const o = chartOpts();
  S.chart = buildChart(host, Object.assign({
    coin: S.asset, tf: cfg.tf, tfSec: API.TF_SEC[cfg.tf], prec: S.prec, theme: cfg.theme,
    tzOffset: tzOffset(cfg.tz), chartType: cfg.chartType, scaleMode: cfg.scaleMode, colors: o.colors, ind: o.ind,
    onScaleMode: m => { cfg.scaleMode = m; saveCfg(); },
    alerts: AL ? AL.forKey(S.asset) : [],
    onDrawingsSaved: shapes => pushDrawings(S.asset, shapes), source: S.tradfi ? 'Yahoo · ' + S.ticker : 'Binance · ' + S.sym,
    candles: S.chartBars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })),
    vol: S.chartBars.map(b => b.v || 0),
    impDet: o.impDet, impHollow: o.impHollow, layers: o.layers,
    panes,
    onNeedHistory: () => loadOlder(),
  }, alertHooks(S.asset, S.sym, S.tradfi, S.prec), overlays(S.r)));
  fillPanes();
  $('#chartFoot').innerHTML = S.metal
    ? `Binance ${esc(S.sym)} TradFi perpetual · live, 24/7 · price data only · scroll / + − to zoom · keys 1–9 timeframe, F full screen · Alt+A alert · ${VERSION}`
    : S.tradfi
    ? `Yahoo Finance · ${esc(S.ticker)} · updates every 30 s · scroll / + − to zoom · drag (also up/down) · wheel on price axis to stretch · double-click axis to reset · keys 1–9 timeframe, F full screen · Alt+A alert`
    : `Binance ${esc(S.sym)} perpetual · live · OI / CVD / liquidations: Coinalyze (OI from ${cfg.oiMarkets} perp markets, CVD from the top 6 perp + 3 spot) · CVD counts from the first loaded candle (zoom doesn't change it) · scroll left for more history · keys 1–9 timeframe, F full screen, / search, Alt+A alert, right-click for more · ${VERSION}`;
}

async function loadChart(g) {
  const tf = cfg.tf;
  clearTimers(S.chartTimers);
  if (S.ws) { S.ws.close(); S.ws = null; }
  $('#chart').innerHTML = '<div class="loading">Loading chart…</div>';
  S.noMoreHistory = false;
  try {
    S.chartBars = S.tradfi ? await API.yahooBars(S.ticker, tf) : await API.klines(S.sym, tf, 1000);
    S.priceErr = null;
  } catch (e) {
    if (g !== S.gen) return;
    S.priceErr = S.tradfi ? 'Yahoo Finance: ' + e.message : `Binance price feed not reachable (${e.message}). Binance blocks some countries / networks.`;
    $('#chart').innerHTML = `<div class="loading">${esc(S.priceErr)}</div>`;
    return;
  }
  if (g !== S.gen || tf !== cfg.tf) return;
  S.lastTick = Date.now() / 1000;
  S.flowChart = null;
  buildChartNow();
  loadFullHistory(g, tf);
  if (S.tradfi) {
    every(async () => {
      try {
        const b = await API.yahooBars(S.ticker, tf);
        if (g !== S.gen || tf !== cfg.tf) return;
        b.slice(-3).forEach(x => applyBar(x, tf));
        S.lastTick = Date.now() / 1000;
      } catch (e) { /* keep last */ }
    }, 30000, S.chartTimers);
  } else {
    S.wsState = 'connecting';
    S.ws = API.liveKlines(S.sym, tf, bar => { if (g === S.gen && tf === cfg.tf) applyBar(bar, tf); }, s => { S.wsState = s; updateStatus(); });
    if (needChartFlow(tf)) loadChartFlow(g);   // otherwise the entry-timeframe data fills the panes
    if (cfg.panes.includes('cbp')) loadCbp(g);
    every(() => { if (needChartFlow(tf)) loadChartFlow(g); if (cfg.panes.includes('cbp')) loadCbp(g); }, 60000, S.chartTimers);
  }
}

const needChartFlow = tf => tf !== cfg.ltf && !canResample(tf, cfg.ltf) && API.CZ_TFS.has(tf);
function applyBar(bar, tf) {
  const B = S.chartBars, last = B[B.length - 1];
  if (last && bar.t < last.t) return;
  if (last && bar.t === last.t) B[B.length - 1] = bar; else B.push(bar);
  S.lastTick = Date.now() / 1000;
  if (S.chart) S.chart.update(bar);
  if (AL) AL.feed(S.asset, bar.c);
  const px = $('#heroPx'); if (px) px.textContent = UI.fp(bar.c, S.prec);
  document.title = `${S.asset} ${UI.fp(bar.c, S.prec)} · LOF`;
  // keep the analysis candles current when the chart and entry timeframe match
  if (tf === cfg.ltf && S.bars.ltf && S.bars.ltf.length) {
    const L = S.bars.ltf, l = L[L.length - 1];
    if (bar.t === l.t) L[L.length - 1] = bar; else if (bar.t > l.t) { L.push(bar); L.shift(); }
    if (bar.closed || Date.now() - (S.lastRun || 0) > 15000) runAnalysis();
  }
}

// Older candles when you scroll to the left edge (like TradingView), back to the day the market was listed.
// On 4h / 12h / 1D the full history loads straight away.
const MAX_BARS = 60000;
let loadingOlder = false;
async function fetchOlder(g, tf) {
  const first = S.chartBars[0].t;
  const older = (await API.klines(S.sym, tf, 1500, first * 1000 - 1)).filter(b => b.t < first);
  if (g !== S.gen || tf !== cfg.tf) return false;
  if (!older.length) { S.noMoreHistory = true; return false; }
  S.chartBars = older.concat(S.chartBars);
  if (older.length < 1400) S.noMoreHistory = true;          // reached the listing date
  return true;
}
async function loadOlder() {
  if (loadingOlder || S.tradfi || S.noMoreHistory || !S.chartBars.length || S.chartBars.length >= MAX_BARS) return;
  loadingOlder = true;
  const g = S.gen, tf = cfg.tf;
  try { if (await fetchOlder(g, tf)) buildChartNow(); }
  catch (e) { /* try again on the next scroll */ }
  finally { setTimeout(() => { loadingOlder = false; }, 400); }
}
async function loadFullHistory(g, tf) {
  if (S.tradfi || !['4h', '12h', '1D', '1W', '1M'].includes(tf)) return;
  loadingOlder = true;
  let added = false;
  try {
    for (let i = 0; i < 12 && !S.noMoreHistory && S.chartBars.length < MAX_BARS; i++) {
      if (!(await fetchOlder(g, tf))) break;
      added = true;
    }
  } catch (e) { /* keep what we have */ }
  loadingOlder = false;
  if (added && g === S.gen && tf === cfg.tf) buildChartNow();
}

async function loadChartFlow(g) {
  const tf = cfg.tf;
  try {
    const P = cfg.panes, parts = [];
    if (P.includes('oi')) parts.push('oi');
    if (P.includes('perp') || P.includes('cvd2')) parts.push('perp');
    if (P.includes('spot') || P.includes('cvd2')) parts.push('spot');
    if (!parts.length && !P.includes('liq')) { S.flowChart = null; return; }
    const f = await API.czFlow(S.sym, tf, { liq: P.includes('liq'), parts, n: cfg.oiMarkets });
    if (g !== S.gen || tf !== cfg.tf) return;
    S.flowChart = f;
  } catch (e) {
    if (g !== S.gen) return;
    S.flowChart = { error: e.message };
  }
  fillPanes();
}

async function loadCbp(g) {
  const tf = cfg.tf;
  const G = { '1m': [60], '5m': [300], '15m': [900], '30m': [900, 1800], '1h': [3600], '2h': [3600, 7200], '4h': [3600, 14400], '12h': [21600, 43200], '1D': [86400] }[tf];
  if (!G) { S.cbp = []; fillPanes(); return; }
  try {
    const [cb, bn] = await Promise.all([API.coinbaseCandles(S.base.replace(/^1000+/, '') + '-USD', G[0]), API.spotKlines(S.base.replace(/^1000+/, '') + 'USDT', tf, 300)]);
    if (g !== S.gen || tf !== cfg.tf) return;
    const cbr = G[1] ? API.resample(cb, G[1]) : cb;
    const bnMap = new Map(bn.map(b => [b.t, b.c]));
    S.cbp = cbr.filter(b => bnMap.has(b.t)).map(b => ({ time: b.t, value: (b.c / bnMap.get(b.t) - 1) * 100 }));
    S.cbOk = true;
  } catch (e) {
    S.cbp = []; S.cbOk = false;
  }
  fillPanes();
}

// ── analysis ────────────────────────────────────────────────
function runAnalysis() {
  if (!S.bars.ltf || !S.bars.daily) return;
  S.lastRun = Date.now();
  let r;
  try {
    const noFlow = S.tradfi || S.metal;
    const flow = noFlow ? null : (S.flow && !S.flow.error ? S.flow : null);
    r = analyze({ ltf: S.bars.ltf, daily: S.bars.daily, h4: S.bars.h4, m30: S.bars.m30, flow, snap: flow && flow.snap,
      tradfi: noFlow, params: Object.assign({}, cfg.params, { manual: S.manual }) });
  } catch (e) { toast('Analysis error: ' + esc(e.message)); return; }
  S.r = r;
  if (S.tradfi) S.perf = perfFromDaily(S.bars.daily, r.price);
  renderPanels();
  if (S.chart) S.chart.setOverlays(overlays(r));
  // signals: record + alert (only when order flow is in, so the score is final)
  if (r.decision !== 'WAIT' && (S.tradfi || S.metal || (S.flow && !S.flow.error))) onReady(S.asset, S.sym, !S.tradfi, r, 'main');
}

function renderPanels() {
  const s = st(), r = S.r;
  UI.renderHero(s, r);
  UI.renderOverview(s, r, S.ov);
  UI.renderPlan(s, r, setLtf, saveJournal);
  UI.renderChecklist(s, r, v => { S.manual = v; runAnalysis(); });
  UI.renderBias(s, r);
  UI.renderLevels(s, r);
  UI.renderFlow(s, r, S.tradfi ? null : S.flow);
  UI.renderMarkets(s, S.tradfi ? null : S.flow, S.cbOk);
  if (r) document.title = `${S.asset} ${UI.fp(r.price, S.prec)} · LOF`;
}

async function loadAnalysisBars(g, which = 'all') {
  const ltf = cfg.ltf;
  try {
    if (S.tradfi) {
      const t = S.ticker;
      const jobs = [API.yahooBars(t, ltf)];
      if (which === 'all') jobs.push(API.yahooRaw(t, '30m', '1mo').then(x => x.bars), API.yahooBars(t, '4h'), API.yahooRaw(t, '1d', '1y').then(x => x.bars));
      const [l, m30, h4, d] = await Promise.all(jobs);
      if (g !== S.gen || ltf !== cfg.ltf) return;
      S.bars.ltf = l;
      if (which === 'all') Object.assign(S.bars, { m30, h4, daily: d });
    } else {
      const jobs = [API.klines(S.sym, ltf, 400)];
      if (which === 'all') jobs.push(API.klines(S.sym, '1D', 400), API.klines(S.sym, '4h', 200), API.klines(S.sym, '30m', 720));
      const [l, d, h4, m30] = await Promise.all(jobs);
      if (g !== S.gen || ltf !== cfg.ltf) return;
      S.bars.ltf = l;
      if (which === 'all') Object.assign(S.bars, { daily: d, h4, m30 });
    }
    runAnalysis();
  } catch (e) {
    if (g === S.gen) { S.priceErr = e.message; updateStatus(); }
  }
}

async function loadFlow(g) {
  const ltf = cfg.ltf;
  try {
    const f = await API.czFlow(S.sym, ltf, { snap: true, liq: true, bars: 1000, n: cfg.oiMarkets });
    if (g !== S.gen || ltf !== cfg.ltf) return;
    S.flow = f;
  } catch (e) {
    if (g !== S.gen) return;
    S.flow = { error: e.message };
  }
  fillPanes();
  runAnalysis();
  updateStatus();
}

async function loadOverview(g) {
  if (S.tradfi) return;
  const sym = S.base.replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, '').toLowerCase();
  try {
    let id = (cfg.cgId[S.asset] || '').trim();
    if (!id) {
      const s = await API.cg('search', { query: sym });
      const hits = (s.coins || []).filter(c => (c.symbol || '').toLowerCase() === sym).sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9));
      if (!hits.length) throw new Error('not found');
      id = hits[0].id;
    }
    const j = await API.cg('coins/' + id, { localization: 'false', tickers: 'false', community_data: 'false', developer_data: 'false' });
    if (g !== S.gen) return;
    const md = j.market_data || {}, usd = k => (md[k] || {}).usd;
    const price = usd('current_price');
    let fdv = usd('fully_diluted_valuation');
    if (price && md.max_supply) fdv = price * md.max_supply; else if (price && md.total_supply) fdv = price * md.total_supply;
    S.ov = { id, name: j.name, rank: j.market_cap_rank, inflationary: !md.max_supply, mcap: usd('market_cap'), fdv, volume: usd('total_volume'),
      ath: usd('ath'), ath_chg: usd('ath_change_percentage'), chg_7d: md.price_change_percentage_7d, chg_30d: md.price_change_percentage_30d,
      max: md.max_supply, categories: (j.categories || []).filter(Boolean).slice(0, 3) };
    S.title = `${j.name} (${S.asset})`;
    S.sub = [S.ov.rank ? `Rank #${S.ov.rank}` : '', `CoinGecko: ${esc(id)}`, S.ov.categories.map(esc).join(', ')].filter(Boolean).join(' · ') + '<br>' + S.baseSub;
  } catch (e) {
    if (g !== S.gen) return;
    S.ov = null;
  }
  renderPanels();
}

// ── load an asset ───────────────────────────────────────────
async function loadAsset(key) {
  if (!API.TRADFI[key] && !S.byBase[key]) { toast(`${esc(key)} isn't available on Binance futures.`); key = 'BTC'; }
  const g = ++S.gen;
  clearTimers(S.timers); clearTimers(S.chartTimers);
  if (S.ws) { S.ws.close(); S.ws = null; }
  Object.assign(S, { asset: key, tradfi: !!API.TRADFI[key], bars: {}, chartBars: [], flow: null, flowChart: null, cbp: null, cbOk: null,
    r: null, ov: undefined, chg24: NaN, perf: null, manual: false, priceErr: null, lastTick: 0, wsState: 'connecting', metal: false });
  cfg.asset = key; saveCfg();
  if (S.tradfi) {
    const d = API.TRADFI[key];
    Object.assign(S, { ticker: d.t, sym: d.t, base: key, title: d.name, sub: `Chart: Yahoo Finance · ${esc(d.t)} · price data only (no order flow)`, prec: ['US2Y', 'US10Y', 'US30Y'].includes(key) ? 3 : key === 'ETHBTC' ? 5 : 2 });
  } else {
    const m = S.byBase[key];
    Object.assign(S, { sym: m.sym, base: m.base, prec: m.prec, metal: !!m.metal,
      title: m.metal ? `${METALS_NAME[key]} (${m.sym})` : key,
      sub: m.metal ? `Chart: Binance · ${esc(m.sym)} · TradFi perpetual · live, 24/7 · price data only (no Coinalyze order flow)` : `Chart: Binance · ${esc(m.sym)} · ${m.quote} perpetual · live` });
    S.baseSub = S.sub;
  }
  renderQuick(); renderPanels(); updateStatus();
  if (WL) WL.render();
  pullDrawings(key, g);
  history.replaceState(null, '', '#' + encodeURIComponent(key));

  loadChart(g);
  loadAnalysisBars(g, 'all');
  if (!S.tradfi) {
    if (!S.metal) { loadFlow(g); loadOverview(g); }
    const tick = async () => { try { const t = await API.ticker24(S.sym); if (g === S.gen) { S.chg24 = +t.priceChangePercent; UI.renderHero(st(), S.r); } } catch (e) { /* ignore */ } };
    tick();
    every(tick, 60000);
    if (!S.metal) every(() => loadFlow(g), 60000);
    every(() => { if (cfg.tf !== cfg.ltf) loadAnalysisBars(g, 'ltf'); }, 30000);
  } else {
    every(() => loadAnalysisBars(g, 'ltf'), 30000);
  }
  every(() => loadAnalysisBars(g, 'all'), 10 * 60000);
}

// ── drawings sync between devices (when cloud storage is connected) ──
const drawTimers = {};
function pushDrawings(coin, shapes) {
  if (!S.server || !S.server.storage) return;
  clearTimeout(drawTimers[coin]);
  drawTimers[coin] = setTimeout(() => API.storePut('draw:' + coin, shapes).catch(() => {}), 1500);
}
async function pullDrawings(coin, g) {
  if (!S.server || !S.server.storage) return;
  try {
    const j = await API.storeGet('draw:' + coin);
    if (!j.enabled || !Array.isArray(j.value) || g !== S.gen) return;
    const k = 'lof_draw_' + coin, localAt = +(localStorage.getItem(k + '_at') || 0);
    if ((j.at || 0) <= localAt || localStorage.getItem(k) === JSON.stringify(j.value)) return;
    localStorage.setItem(k, JSON.stringify(j.value)); localStorage.setItem(k + '_at', String(j.at));
    if (S.chart && S.chartBars.length) buildChartNow();
    MINIS.forEach(m => m.reloadDrawings(coin));
  } catch (e) { /* keep local */ }
}

// ── controls ────────────────────────────────────────────────
function setTf(tf) {
  if (!TFS.includes(tf) || tf === cfg.tf) return;
  cfg.tf = tf; saveCfg(); renderBar();
  S.cbp = null;
  loadChart(S.gen);
}
function setLtf(ltf) {
  if (ltf === cfg.ltf) return;
  cfg.ltf = ltf; saveCfg();
  S.flow = null; S.r = null; renderPanels();
  const g = S.gen;
  loadAnalysisBars(g, 'ltf');
  if (!S.tradfi) loadFlow(g);
  if (!S.tradfi && needChartFlow(cfg.tf)) loadChartFlow(g);
}

function renderBar() {
  $('#tfs').innerHTML = TFS.map(t => `<button data-tf="${t}" class="${t === cfg.tf ? 'on' : ''}" title="${HOT.includes(t) ? 'Key ' + (HOT.indexOf(t) + 1) : t}">${TF_LABEL[t] || t}</button>`).join('');
  $('#tfs').querySelectorAll('[data-tf]').forEach(b => b.onclick = () => setTf(b.dataset.tf));
  $('#sizes').innerHTML = Object.keys(SIZES).map(s => `<button data-s="${s}" class="${s === cfg.size ? 'on' : ''}">${s}</button>`).join('');
  $('#sizes').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    cfg.size = b.dataset.s; saveCfg(); renderBar();
    $('#chart').style.height = chartHeight(chartPanes().length) + 'px';
  });
  const opt = (list, sel, attr) => list.map(([k, n]) => `<span class="opt ${sel.includes(k) ? 'on' : ''}" data-${attr}="${esc(k)}">${esc(n)}</span>`).join('');
  $('#mPanes .pop').innerHTML = `<h4>Panes under the chart</h4><div class="opts">${opt(PANES, cfg.panes, 'p')}</div>
    <div class="muted" style="margin-top:8px;font-size:11.5px">OI, CVD and liquidations: Coinalyze. Volume: Binance. Coinbase premium: Coinbase vs Binance spot.</div>`;
  $('#mLayers .pop').innerHTML = `<h4>Chart type</h4><div class="seg wrap" id="ctypes">${CHART_TYPES.map(([k, n]) => `<button data-ct="${k}" class="${k === cfg.chartType ? 'on' : ''}">${n}</button>`).join('')}</div>
    <h4>Lines</h4><div class="opts">${opt(LINE_LAYERS.map(x => [x, x]), cfg.lines, 'l')}</div>
    <h4>Zones &amp; profiles</h4><div class="opts">${opt(ZONE_LAYERS.map(x => [x, x]), cfg.zones, 'z')}</div>
    <h4>Impulse candles (3 detectors)</h4>
    <table class="imptbl"><tr><th></th><th>Length</th><th>Size ×</th><th>Volume ×</th><th>Body / wick</th><th>Colour</th></tr>
      ${cfg.impDet.map((d, i) => `<tr><td><label><input type="checkbox" data-dn="${i}" ${d.on !== false ? 'checked' : ''}> ${i + 1}</label></td>
        <td><input type="number" data-d="${i}:len" min="2" max="200" value="${d.len}"></td><td><input type="number" data-d="${i}:size" min="0.5" max="10" step="0.1" value="${d.size}"></td>
        <td><input type="number" data-d="${i}:vol" min="0" max="10" step="0.1" value="${d.vol}"></td><td><input type="number" data-d="${i}:ratio" min="0" max="1" step="0.05" value="${d.ratio}"></td>
        <td><input type="color" data-dc="${i + 1}" value="${cfg.colors['imp' + (i + 1)] || DEFAULT_COLORS['imp' + (i + 1)]}"></td></tr>`).join('')}</table>
    <label class="tickrow"><input type="checkbox" id="impHollow" ${cfg.impHollow ? 'checked' : ''}> Bearish impulse candles hollow (outline only)</label>
    <div class="muted" style="font-size:11px;margin-top:4px">A candle is marked when its body ≥ size × the average body, its volume ≥ volume × the average volume, and body ÷ full range ≥ the ratio (averages over "length" candles). Detector 3 wins over 2 and 1. <a href="#" id="impReset">Reset</a></div>
    <h4>How many to show (past opens, highs / lows)</h4><div class="hist">${HIST_ROWS.map(([k, n]) => `<label>${n}<select data-h="${k}">${[1, 2, 3, 4, 5, 6, 8, 10].map(v => `<option ${+cfg.hist[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>`;
  const I = cfg.ind, num = (k, lo, hi, step = 1) => `<input type="number" data-n="${k}" min="${lo}" max="${hi}" step="${step}" value="${I[k]}">`;
  $('#mInd .pop').innerHTML = `<h4>Indicators</h4><div class="opts">${opt(IND_ROWS, IND_ROWS.filter(([k]) => I[k]).map(([k]) => k), 'ind')}</div>
    <h4>Zones &amp; liquidity</h4><div class="opts">${opt([['Liquidity: equal highs / lows', 'Liquidity: equal highs / lows (EQH / EQL)'], ['Liquidity: swing highs / lows', 'Liquidity: swing highs / lows (BSL / SSL)'], ['Fair value gaps', 'Fair value gaps (FVG)'], ['Session highs / lows', 'Session highs / lows']], cfg.zones, 'z')}</div>
    <h4>Settings</h4><div class="indset">
      <label>Supertrend length ${num('stLen', 1, 100)}</label><label>Supertrend factor ${num('stMult', 0.5, 10, 0.1)}</label>
      <label>RSI length ${num('rsiLen', 2, 100)}</label><label>ATR length ${num('atrLen', 1, 100)}</label>
      <label>MACD fast ${num('macdFast', 1, 100)}</label><label>MACD slow ${num('macdSlow', 2, 200)}</label><label>MACD signal ${num('macdSig', 1, 100)}</label></div>
    <div class="muted" style="font-size:11px;margin-top:6px;line-height:1.5">For your setup: session highs / lows are the sweep targets (✓ = swept). FVGs show imbalance to fill on the pullback. Anchored VWAP from the swing high / low shows fair value after the sweep. RSI divergence arrows help confirm the MSS. ATR helps size the stop.</div>`;
  $('#layouts').innerHTML = [[1, '▢', '1 chart'], [2, '◫', '2 charts'], [4, '⊞', '4 charts']].map(([n, ic, t]) => `<button data-lay="${n}" class="${cfg.layout === n ? 'on' : ''}" title="${t}">${ic}</button>`).join('');
  $('#layouts').querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { cfg.layout = +b.dataset.lay; saveCfg(); renderBar(); setupMinis(); });
  const toggle = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : arr.concat([v]);
  const M = sel => document.querySelectorAll('#mPanes ' + sel + ', #mLayers ' + sel + ', #mInd ' + sel);
  const rebuildAll = () => { buildChartNow(); rebuildMinis(); };
  M('[data-h]').forEach(x => x.onchange = () => { cfg.hist[x.dataset.h] = +x.value; saveCfg(); rebuildAll(); });
  M('[data-ind]').forEach(b => b.onclick = () => { cfg.ind[b.dataset.ind] = !cfg.ind[b.dataset.ind]; saveCfg(); renderBar(); rebuildAll(); });
  M('[data-n]').forEach(x => x.onchange = () => { const v = +x.value; if (isNum(v) && v > 0) { cfg.ind[x.dataset.n] = v; saveCfg(); rebuildAll(); } });
  M('[data-ct]').forEach(b => b.onclick = () => { cfg.chartType = b.dataset.ct; saveCfg(); renderBar(); rebuildAll(); });
  M('[data-p]').forEach(b => b.onclick = () => {
    cfg.panes = toggle(cfg.panes, b.dataset.p); saveCfg(); renderBar();
    if (b.dataset.p === 'cbp' && cfg.panes.includes('cbp') && !S.tradfi) loadCbp(S.gen);
    if (cfg.panes.includes(b.dataset.p) && b.dataset.p !== 'cbp' && b.dataset.p !== 'vol' && !S.tradfi && needChartFlow(cfg.tf)) loadChartFlow(S.gen);
    buildChartNow();
  });
  M('[data-l]').forEach(b => b.onclick = () => { cfg.lines = toggle(cfg.lines, b.dataset.l); saveCfg(); renderBar(); rebuildAll(); });
  M('[data-z]').forEach(b => b.onclick = () => { cfg.zones = toggle(cfg.zones, b.dataset.z); saveCfg(); renderBar(); rebuildAll(); });
  M('[data-d]').forEach(x => x.onchange = () => { const [i, k] = x.dataset.d.split(':'), v = +x.value; if (isNum(v)) { cfg.impDet[+i][k] = v; saveCfg(); rebuildAll(); } });
  M('[data-dn]').forEach(x => x.onchange = () => { cfg.impDet[+x.dataset.dn].on = x.checked; saveCfg(); rebuildAll(); });
  M('[data-dc]').forEach(x => x.onchange = () => { cfg.colors['imp' + x.dataset.dc] = x.value; saveCfg(); rebuildAll(); });
  const ih = $('#impHollow'); if (ih) ih.onchange = () => { cfg.impHollow = ih.checked; saveCfg(); rebuildAll(); };
  const ir = $('#impReset'); if (ir) ir.onclick = e => { e.preventDefault(); cfg.impDet = JSON.parse(JSON.stringify(IMP_DEFAULT)); ['imp1', 'imp2', 'imp3'].forEach(k => delete cfg.colors[k]); saveCfg(); renderBar(); rebuildAll(); };
}
['#mPanes', '#mLayers', '#mInd'].forEach(id => {
  $(id + ' > .btn').onclick = e => { e.stopPropagation(); const open = $(id).classList.contains('open'); document.querySelectorAll('.menu').forEach(m => m.classList.remove('open')); if (!open) $(id).classList.add('open'); };
  $(id + ' .pop').onclick = e => e.stopPropagation();
});
document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(m => m.classList.remove('open')));

// tabs
$('#tabs').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
  $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  ['screener', 'pulse', 'calendar', 'history', 'markets'].forEach(t => { $('#tab-' + t).hidden = t !== b.dataset.tab; });
  if (b.dataset.tab === 'calendar' && CAL) CAL.render();
  if (b.dataset.tab === 'history') X.renderHistory(X.loadHist(), loadAsset);
});

// ── journal ─────────────────────────────────────────────────
async function saveJournal() {
  const r = S.r; if (!r) return;
  const t = { coin: S.asset, side: r.lead_long ? 'LONG' : 'SHORT', setup: r.setup, entry: +UI.fp(r.price, S.prec).replace(/,/g, ''),
    sl: +UI.fp(r.sl, S.prec).replace(/,/g, ''), tp1: +UI.fp(r.tp1, S.prec).replace(/,/g, ''), tp2: isNum(r.tp2) ? +UI.fp(r.tp2, S.prec).replace(/,/g, '') : null,
    rr: isNum(r.rr) ? +r.rr.toFixed(2) : null, score: r.score, tf: cfg.ltf, notes: `${r.regime[0]} · ${r.loc.zone} · session ${r.session}` };
  try { const j = await API.saveJournal(t); toast(`Saved to Notion. ${j.url ? `<a href="${esc(j.url)}" target="_blank">Open</a>` : ''}`); }
  catch (e) { toast(/not set up/i.test(e.message) ? 'Notion isn\'t set up yet. Add NOTION_TOKEN and NOTION_DB_ID in Vercel (see README).' : 'Journal error: ' + esc(e.message), 6000); }
}

// ── screener + alerts + history ─────────────────────────────
function onReady(key, sym, isCrypto, r, source) {
  X.recordSignal(key, sym, isCrypto, r, cfg.ltf, source);
  const k = key + ':' + r.decision;
  if (S.alerted[k] && r.now - S.alerted[k] < 7200) return;      // one alert per market + side every 2 hours
  S.alerted[k] = r.now;
  try { localStorage.setItem('lof_alerted', JSON.stringify(S.alerted)); } catch (e) { /* ignore */ }
  X.fireAlert(cfg, S.server && S.server.telegram, key, r, cfg.ltf);
}

let scanning = false;
async function runScan() {
  if (scanning || !S.symbols.length) return;
  scanning = true;
  const keys = watchKeys().filter(k => API.TRADFI[k] || S.byBase[k]);
  let prem = {};
  try { prem = await API.premiumAll(); } catch (e) { /* ignore */ }
  const out = [];
  const status = () => `Watchlist scan · ${out.length}/${keys.length} · entry TF ${cfg.ltf}${S.scanAt ? ' · last full scan ' + new Date(S.scanAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''} · list: ${esc(WL ? $('#wlName').textContent.replace('▾', '').trim() : 'Main')} (switch it in the watchlist panel)`;
  const q = keys.slice();
  async function worker() {
    while (q.length) {
      const k = q.shift();
      try {
        const crypto = isCryptoKey(k);
        const x = await X.scanAsset(k, crypto, crypto ? S.byBase[k].sym : API.TRADFI[k].t, cfg.ltf, cfg.params, prem);
        out.push(x);
        if (x.r.decision !== 'WAIT' && k !== S.asset) onReady(k, x.sym, crypto, x.r, 'screener');
      } catch (e) { /* skip this one */ }
      S.scan = out.slice();
      X.renderScreener(S.scan, S.asset, loadAsset, status());
      bindEditWatch();
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  S.scanAt = Date.now() / 1000;
  S.scan = out;
  X.renderScreener(S.scan, S.asset, loadAsset, status());
  bindEditWatch();
  renderQuick();
  scanning = false;
}
function bindEditWatch() { /* the list is edited in the watchlist panel */ }

// ── settings drawer ─────────────────────────────────────────
function openSettings() {
  const d = $('#drawer'), p = cfg.params, sv = S.server || {};
  d.innerHTML = `<h2>Settings <button class="icon-btn" id="dClose">✕</button></h2>
    <h4>Time zone</h4>
    <div class="muted" style="font-size:11.5px">Click the clock in the top bar to change it (now ${esc(cfg.tz === 'local' ? 'local time' : cfg.tz)}). Watchlists: use the panel on the right (▾ for more lists).</div>
    <h4>Colours</h4>
    <div class="colors">${Object.keys(DEFAULT_COLORS).map(k => `<label><input type="color" data-col="${k}" value="${cfg.colors[k] || DEFAULT_COLORS[k]}">${esc(COLOR_NAMES[k] || k)}</label>`).join('')}
      ${OPENS.map(([n, k, c]) => `<label><input type="color" data-col="op_${k}" value="${cfg.colors['op_' + k] || c}">${esc(n)}</label>`).join('')}</div>
    <div class="field"><button class="btn" id="colReset">Reset colours</button></div>
    <h4>Strategy</h4>
    <div class="field"><span>Swing strength (MSS pivots)</span><input type="number" id="sPiv" min="1" max="10" value="${p.piv}"></div>
    <div class="field"><span>Sweep / MSS valid for (bars)</span><input type="number" id="sValid" min="5" max="60" value="${p.valid}"></div>
    <div class="field"><span>Minimum R:R</span><input type="number" id="sRR" min="0.5" max="10" step="0.1" value="${p.minRR}"></div>
    <div class="field"><span>Minimum score (of 9)</span><input type="number" id="sScore" min="1" max="9" value="${p.minScore}"></div>
    <h4>Order flow coverage (Coinalyze)</h4>
    <div class="field"><span>OI from how many perp markets</span><div class="seg" id="oiN">${[6, 12, 20].map(n => `<button data-n="${n}" class="${cfg.oiMarkets === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
    <div class="muted" style="font-size:11.5px">20 = closest to coinalyze.net's aggregated OI, but uses more of the 40 calls per minute, so switching coins quickly can be slower. CVD always uses the top 6 perp + 3 spot markets.</div>
    <h4>Alerts (when a market turns LONG / SHORT READY)</h4>
    <div class="field"><span>Browser notification</span><input type="checkbox" id="aBrowser" ${cfg.alerts.browser ? 'checked' : ''}></div>
    <div class="field"><span>Telegram ${sv.telegram ? '' : '<span class="muted">(not set up, see README)</span>'}</span><input type="checkbox" id="aTg" ${cfg.alerts.telegram ? 'checked' : ''} ${sv.telegram ? '' : 'disabled'}></div>
    <div class="field"><button class="btn" id="aTest" ${sv.telegram ? '' : 'disabled'}>Send test message</button></div>
    <div class="muted" style="font-size:11.5px">Alerts run while the dashboard is open (phone or PC). The screener checks your watchlist every 3 minutes.</div>
    ${S.tradfi ? '' : `<h4>Coin info</h4><div class="field"><span>CoinGecko ID for ${esc(S.asset)}</span><input type="text" id="cgId" placeholder="auto" value="${esc(cfg.cgId[S.asset] || '')}"></div>`}
    <h4>Setup</h4>
    <div class="muted" style="line-height:1.7">Coinalyze: ${sv.coinalyze ? '<span class="up">connected</span>' : '<span class="dn">missing key</span>'} · Telegram: ${sv.telegram ? '<span class="up">set up</span>' : 'not set up'} · Notion journal: ${sv.notion ? '<span class="up">set up</span>' : 'not set up'}</div>
    <div class="field"><button class="btn" id="rLayout">Reset chart layout</button><a class="btn" href="/login.html" id="logout">Sign out</a></div>`;
  d.classList.add('open');
  $('#dClose').onclick = () => d.classList.remove('open');
  const num = (id, key, lo, hi) => $(id).onchange = e => { const v = Math.min(hi, Math.max(lo, +e.target.value)); if (isNum(v)) { cfg.params[key] = v; saveCfg(); runAnalysis(); } };
  num('#sPiv', 'piv', 1, 10); num('#sValid', 'valid', 5, 60); num('#sRR', 'minRR', 0.5, 10); num('#sScore', 'minScore', 1, 9);
  $('#aBrowser').onchange = async e => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p2 = await Notification.requestPermission();
      if (p2 !== 'granted') { e.target.checked = false; toast('Notifications are blocked in your browser settings.'); }
    }
    cfg.alerts.browser = e.target.checked; saveCfg();
  };
  $('#aTg').onchange = e => { cfg.alerts.telegram = e.target.checked; saveCfg(); };
  $('#oiN').querySelectorAll('[data-n]').forEach(b => b.onclick = () => { cfg.oiMarkets = +b.dataset.n; saveCfg(); openSettings(); loadAsset(S.asset); });
  $('#aTest').onclick = async () => { try { await API.sendTelegram('✅ LOF Dashboard test message'); toast('Test message sent.'); } catch (e) { toast('Telegram error: ' + esc(e.message)); } };
  const cgI = $('#cgId'); if (cgI) cgI.onchange = e => { cfg.cgId[S.asset] = e.target.value.trim(); saveCfg(); S.ov = undefined; loadOverview(S.gen); };
  d.querySelectorAll('[data-col]').forEach(x => x.onchange = () => { cfg.colors[x.dataset.col] = x.value; saveCfg(); buildChartNow(); rebuildMinis(); });
  $('#colReset').onclick = () => { cfg.colors = {}; saveCfg(); buildChartNow(); rebuildMinis(); openSettings(); };
  $('#rLayout').onclick = () => { Object.assign(cfg, { lines: DEFAULTS.lines, zones: DEFAULTS.zones, panes: DEFAULTS.panes, size: 'M', impulse: 'Normal' }); saveCfg(); renderBar(); buildChartNow(); };
  $('#logout').onclick = () => { document.cookie = 'lof_auth=; Max-Age=0; path=/'; };
}
$('#btnSettings').onclick = openSettings;
function applyTheme() {
  document.body.classList.toggle('light', cfg.theme === 'light');
  $('#btnTheme').textContent = cfg.theme === 'light' ? '☾' : '☀';
  document.querySelector('meta[name=theme-color]').content = cfg.theme === 'light' ? '#f4f6f9' : '#0b0e14';
}
$('#btnTheme').onclick = () => { cfg.theme = cfg.theme === 'light' ? 'dark' : 'light'; saveCfg(); applyTheme(); buildChartNow(); rebuildMinis(); };
applyTheme();

// ── start ───────────────────────────────────────────────────
async function loadFng() {
  try {
    const j = await API.fngHistory();
    S.fng = (j.data || []).map(x => ({ t: +x.timestamp, v: +x.value })).sort((a, b) => a.t - b.t);
    fillPanes();
  } catch (e) { /* optional */ }
}

// ── candle timers for every timeframe (time left + how much of the candle has passed)
const TIMER_TFS = ['5m', '15m', '1h', '4h', '1D', '1W', '1M'];
function candleSpan(tf, now) {
  if (tf === '1M') { const d = new Date(now * 1000), a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; return [a, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000]; }
  if (tf === '1W') { const day = Math.floor(now / 86400), a = (day - (day + 3) % 7) * 86400; return [a, a + 7 * 86400]; }
  const sec = API.TF_SEC[tf], a = Math.floor(now / sec) * sec; return [a, a + sec];
}
const fdur = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = n => String(n).padStart(2, '0');
  return d ? `${d}d ${h}h` : h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`; };
function renderTimer() {
  const el = $('#ctimer'); if (!el) return;
  const now = Date.now() / 1000;
  if (!el.dataset.built) {
    el.innerHTML = TIMER_TFS.map(tf => `<div class="ct" data-tf="${tf}"><span class="l">${TF_LABEL[tf] || tf}</span><span class="v num"></span><div class="bar"><i></i></div></div>`).join('');
    el.querySelectorAll('[data-tf]').forEach(d => d.onclick = () => setTf(d.dataset.tf));
    el.dataset.built = 1;
  }
  el.querySelectorAll('[data-tf]').forEach(d => {
    const [a, b] = candleSpan(d.dataset.tf, now), pct = (now - a) / (b - a) * 100;
    d.querySelector('.v').textContent = fdur(b - now);
    d.querySelector('i').style.width = pct.toFixed(1) + '%';
    d.classList.toggle('on', d.dataset.tf === cfg.tf);
    d.classList.toggle('soon', b - now < Math.min(300, (b - a) * 0.1));
    d.title = `${TF_LABEL[d.dataset.tf] || d.dataset.tf} candle: ${fdur(b - now)} left · ${fdur(now - a)} passed (${pct.toFixed(0)}%)`;
  });
}

function setTz(tz) {
  cfg.tz = tz; saveCfg();
  buildChartNow(); rebuildMinis(); X.updateNews(cfg.tz);
  if (CAL) CAL.render();
}

async function start() {
  renderBar();
  createClock({ tz: () => cfg.tz, setTz });
  CAL = createCalendar({ tz: () => cfg.tz, prefs: () => cfg.cal, setPrefs: p => { Object.assign(cfg.cal, p); saveCfg(); } });
  window.__onNews = () => { if (S.chart) S.chart.setOverlays({ news: X.newsForChart() }); };
  loadFng(); setInterval(loadFng, 3600e3);
  const brand = document.querySelector('.brand span'); if (brand) brand.textContent = 'Confluence ' + VERSION;
  X.updateClock(); X.updateNews(cfg.tz); X.loadNews();
  setInterval(() => { X.updateClock(); X.updateNews(cfg.tz); }, 20000);
  setInterval(X.loadNews, 30 * 60000);
  setInterval(updateStatus, 2000);
  API.serverConfig().then(c => { S.server = c; updateStatus(); if (c.storage && S.asset) pullDrawings(S.asset, S.gen); }).catch(() => { S.server = null; });
  try {
    S.symbols = await API.binanceSymbols();
    S.symbols.forEach(s => { if (!S.byBase[s.base]) S.byBase[s.base] = s; });
    // Gold and silver: use Binance's live TradFi perpetuals instead of delayed Yahoo futures when Binance lists them
    for (const [k, b] of Object.entries(METALS)) {
      if (S.byBase[b]) { S.byBase[k] = Object.assign({}, S.byBase[b], { metal: k }); delete API.TRADFI[k]; }
    }
  } catch (e) {
    S.priceErr = 'Binance futures is not reachable from this network: ' + e.message;
    toast(esc(S.priceErr), 10000);
  }
  const scanByKey = () => Object.fromEntries(S.scan.map(x => [x.key, x.r]));
  WL = createWatchlist({ byBase: () => S.byBase, tradfi: API.TRADFI, onPick: k => loadAsset(k), current: () => S.asset, fallbackWatch: cfg.watch,
    scanInfo: k => scanByKey()[k], onChange: () => { renderQuick(); clearTimeout(S.wlScan); S.wlScan = setTimeout(runScan, 1500); } });
  AL = createAlerts({ byBase: () => S.byBase, tradfi: API.TRADFI, server: () => S.server, onPick: k => loadAsset(k),
    current: () => ({ key: S.asset, sym: S.sym, tradfi: S.tradfi, prec: S.prec, price: S.chartBars.length ? S.chartBars[S.chartBars.length - 1].c : (S.r ? S.r.price : NaN) }),
    onChange: () => { if (S.chart) S.chart.setAlerts(AL.forKey(S.asset)); MINIS.forEach(m => m.setAlerts()); } });
  $('#miniSyms').innerHTML = allAssets().slice(0, 1500).map(a => `<option value="${esc(a.key)}">`).join('');
  setupMinis();
  onLogos(() => { renderQuick(); renderPanels(); });
  setTimeout(loadLogos, 3000);
  window.addEventListener('resize', () => { clearTimeout(S.rsz); S.rsz = setTimeout(() => sizeGrid(chartPanes().length), 200); });
  const fromHash = decodeURIComponent(location.hash.slice(1) || '');
  loadAsset(fromHash && (API.TRADFI[fromHash] || S.byBase[fromHash]) ? fromHash : (API.TRADFI[cfg.asset] || S.byBase[cfg.asset] ? cfg.asset : (S.symbols.length ? 'BTC' : 'GOLD')));
  X.renderScreener([], S.asset, loadAsset, 'Scanning watchlist…');
  setTimeout(runScan, 2500);
  setInterval(() => { if (document.visibilityState === 'visible' || cfg.alerts.browser || cfg.alerts.telegram) runScan(); }, 180000);
  X.renderPulse(null, loadAsset); X.renderStrip(null, loadAsset);
  const pulse = () => X.loadPulse().then(p => { X.renderPulse(p, loadAsset); X.renderStrip(p, loadAsset); }).catch(() => {});
  setTimeout(pulse, 1500); setInterval(pulse, 300000);
  const evalH = async () => { const h = await X.evaluateHistory(); if (!$('#tab-history').hidden) X.renderHistory(h, loadAsset); };
  setTimeout(evalH, 8000); setInterval(evalH, 300000);
  window.addEventListener('hashchange', () => { const k = decodeURIComponent(location.hash.slice(1)); if (k && k !== S.asset && (API.TRADFI[k] || S.byBase[k])) loadAsset(k); });
}
start();
