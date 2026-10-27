// Data sources. Prices come straight from Binance in your browser (fast, live).
// Order flow comes from Coinalyze through the server (/api/cz), so the API key stays hidden.

const FAPI = 'https://fapi.binance.com';
const SPOT = 'https://data-api.binance.vision';
export const BN_TF = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '2h': '2h', '4h': '4h', '12h': '12h', '1D': '1d', '1W': '1w', '1M': '1M' };
export const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '12h': 43200, '1D': 86400, '1W': 604800, '1M': 2592000 };
export const CZ_TFS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '12h', '1D']);   // timeframes Coinalyze has

export const TRADFI = {
  GOLD: { t: 'GC=F', name: 'Gold futures (GC)', short: 'Gold' },
  SILVER: { t: 'SI=F', name: 'Silver futures (SI)', short: 'Silver' },
  SPX: { t: 'ES=F', name: 'S&P 500 futures (ES)', short: 'S&P 500' },
  NDX: { t: 'NQ=F', name: 'Nasdaq 100 futures (NQ)', short: 'Nasdaq' },
  DXY: { t: 'DX-Y.NYB', name: 'US Dollar Index (DXY)', short: 'DXY', kind: 'price' },
  US2Y: { t: '2YY=F', name: 'US 2-year yield', short: 'US 2Y', kind: 'yield' },
  US10Y: { t: '^TNX', name: 'US 10-year yield', short: 'US 10Y', kind: 'yield' },
  US30Y: { t: '^TYX', name: 'US 30-year yield', short: 'US 30Y', kind: 'yield' },
  VIX: { t: '^VIX', name: 'VIX volatility index', short: 'VIX', kind: 'price' },
  OIL: { t: 'CL=F', name: 'Crude oil WTI (CL)', short: 'Oil', kind: 'price' },
  ETHBTC: { t: 'ETH-BTC', name: 'ETH / BTC', short: 'ETH/BTC', kind: 'ratio' },
};
export const PULSE_KEYS = ['DXY', 'US2Y', 'US10Y', 'US30Y', 'VIX', 'OIL', 'ETHBTC'];
// Crypto market metrics from CoinGecko (Market Pulse). Shown in the watchlist; no chart of their own.
export const METRICS = {
  BTCD: { short: 'BTC.D', name: 'Bitcoin dominance', pk: 'btc_d', pct: true },
  ETHD: { short: 'ETH.D', name: 'Ethereum dominance', pk: 'eth_d', pct: true },
  USDTD: { short: 'USDT.D', name: 'USDT dominance (up = risk-off)', pk: 'usdt_d', pct: true },
  TOTAL: { short: 'TOTAL', name: 'Crypto market cap', pk: 'total' },
  TOTAL2: { short: 'TOTAL2', name: 'Market cap ex BTC', pk: 'total2' },
  TOTAL3: { short: 'TOTAL3', name: 'Market cap ex BTC and ETH', pk: 'total3' },
};
// added once to the "Main" watchlist (v8.14)
export const MACRO_KEYS = ['DXY', 'US10Y', 'US30Y', 'VIX', 'OIL', 'ETHBTC', 'BTCD', 'ETHD', 'USDTD', 'TOTAL', 'TOTAL2', 'TOTAL3'];

async function getJSON(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts));
    let j = null;
    try { j = await r.json(); } catch (e) { /* not json */ }
    if (r.status === 401 && url.startsWith('/api/')) { location.href = '/login.html'; throw new Error('Not logged in'); }
    if (!r.ok) throw new Error((j && (j.error || j.msg)) || `HTTP ${r.status}`);
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out: ' + url.split('?')[0]);
    throw e;
  } finally { clearTimeout(timer); }
}

// ── Binance futures ─────────────────────────────────────────
export async function binanceSymbols() {
  const KEY = 'lof_bn_symbols_v2';
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && Date.now() - c.at < 12 * 3600e3 && c.list.length) return c.list;
  } catch (e) { /* ignore */ }
  const j = await getJSON(FAPI + '/fapi/v1/exchangeInfo');
  const list = j.symbols
    // PERPETUAL plus Binance TradFi perpetuals (gold XAUUSDT, silver XAGUSDT)
    .filter(s => /PERPETUAL/.test(s.contractType || '') && s.status === 'TRADING' && (s.quoteAsset === 'USDT' || s.quoteAsset === 'USDC'))
    .map(s => {
      const tick = (s.filters.find(f => f.filterType === 'PRICE_FILTER') || {}).tickSize || '0.01';
      const prec = tick.includes('.') ? tick.replace(/0+$/, '').split('.')[1].length : 0;
      return { sym: s.symbol, base: s.baseAsset, quote: s.quoteAsset, prec, tick: +tick };
    })
    .sort((a, b) => (a.quote === 'USDT' ? 0 : 1) - (b.quote === 'USDT' ? 0 : 1) || a.sym.localeCompare(b.sym));
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list })); } catch (e) { /* ignore */ }
  return list;
}

const toBar = k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7], bv: +k[10] });

export async function klines(sym, tf, limit = 1000, endTime) {
  const u = `${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${BN_TF[tf] || tf}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
  return (await getJSON(u)).map(toBar);
}
export async function klinesSince(sym, tf, fromSec) {
  const u = `${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${BN_TF[tf] || tf}&limit=1500&startTime=${fromSec * 1000}`;
  return (await getJSON(u)).map(toBar);
}
export async function spotKlines(sym, tf, limit = 300) {
  return (await getJSON(`${SPOT}/api/v3/klines?symbol=${sym}&interval=${BN_TF[tf] || tf}&limit=${limit}`)).map(toBar);
}
export async function ticker24(sym) { return getJSON(`${FAPI}/fapi/v1/ticker/24hr?symbol=${sym}`); }
// all Binance futures prices + 24h change + 24h volume in one call (for the watchlist)
export async function allTickers() {
  const j = await getJSON(`${FAPI}/fapi/v1/ticker/24hr`, {}, 8000);
  return Object.fromEntries(j.map(x => [x.symbol, { last: +x.lastPrice, chg: +x.priceChangePercent, vol: +x.quoteVolume }]));
}
export async function premiumAll() {
  const j = await getJSON(`${FAPI}/fapi/v1/premiumIndex`);
  return Object.fromEntries(j.map(x => [x.symbol, { funding: +x.lastFundingRate * 100, mark: +x.markPrice, next: x.nextFundingTime }]));
}
export async function binanceOiHist(sym, period = '1h', limit = 30) {
  const j = await getJSON(`${FAPI}/futures/data/openInterestHist?symbol=${sym}&period=${period}&limit=${limit}`);
  return j.map(x => ({ t: Math.floor(x.timestamp / 1000), v: +x.sumOpenInterestValue }));
}

// Live candles: Binance futures websocket (new /market address), with a REST fallback
// that polls every 2 seconds whenever the websocket is silent.
export function liveKlines(sym, tf, onBar, onStatus) {
  let ws = null, closed = false, retry = 0, timer = null, lastMsg = 0, polling = false;
  const iv = BN_TF[tf] || tf;
  const url = `wss://fstream.binance.com/market/ws/${sym.toLowerCase()}@kline_${iv}`;
  const status = s => onStatus && onStatus(s);
  const open = () => {
    if (closed) return;
    try { ws = new WebSocket(url); } catch (e) { return schedule(); }
    ws.onmessage = ev => {
      try {
        const k = JSON.parse(ev.data).k; if (!k) return;
        lastMsg = Date.now(); retry = 0; status('live');
        onBar({ t: Math.floor(k.t / 1000), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.q, bv: +k.Q, closed: k.x });
      } catch (e) { /* ignore */ }
    };
    ws.onclose = () => { if (!closed) schedule(); };
    ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++)); };
  const poll = setInterval(async () => {
    if (closed || Date.now() - lastMsg < 6000 || polling) return;
    polling = true;
    try {
      const j = await getJSON(`${FAPI}/fapi/v1/klines?symbol=${sym}&interval=${iv}&limit=2`, {}, 5000);
      if (closed) return;
      j.map(toBar).forEach(b => onBar(b));
      status('polling');
    } catch (e) { status('reconnecting'); }
    finally { polling = false; }
  }, 2000);
  open();
  return { close() { closed = true; clearTimeout(timer); clearInterval(poll); try { ws && ws.close(); } catch (e) { /* ignore */ } } };
}

// ── Server endpoints ────────────────────────────────────────
export async function czFlow(sym, tf, { snap = false, liq = false, bars = 400, parts = ['oi', 'perp', 'spot'], n = 12 } = {}) {
  return getJSON(`/api/cz?sym=${sym}&tf=${tf}&bars=${bars}&snap=${snap ? 1 : 0}&liq=${liq ? 1 : 0}&parts=${parts.join(',')}&n=${n}`, {}, 65000);
}
export async function serverConfig() { return getJSON('/api/config'); }
// cloud sync (watchlists, drawings) and price alerts
export const storeGet = k => getJSON('/api/store?k=' + encodeURIComponent(k), {}, 10000);
export const storePut = (k, value) => getJSON('/api/store?k=' + encodeURIComponent(k), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }, 10000);
export const alertsGet = () => getJSON('/api/alerts', {}, 10000);
export const alertsDo = body => getJSON('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10000);
export async function sendTelegram(text) {
  return getJSON('/api/tg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
}
export async function saveJournal(trade) {
  return getJSON('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trade) });
}

// ── Yahoo Finance (through the server) ─────────────────────
const YF = { '1m': ['1m', '1d'], '1W': ['1wk', '10y'], '1M': ['1mo', 'max'], '5m': ['5m', '5d'], '15m': ['15m', '1mo'], '30m': ['30m', '1mo'], '1h': ['60m', '3mo'],
  '2h': ['60m', '3mo', 7200], '4h': ['60m', '3mo', 14400], '12h': ['60m', '6mo', 43200], '1D': ['1d', '2y'] };
export function resample(bars, sec) {
  const out = [];
  bars.forEach(b => {
    const t = Math.floor(b.t / sec) * sec, cur = out[out.length - 1];
    if (cur && cur.t === t) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
    else out.push({ t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  });
  return out;
}
export async function yahooRaw(ticker, i, r) {
  const j = await getJSON(`/api/proxy?src=yahoo&t=${encodeURIComponent(ticker)}&i=${i}&r=${r}`);
  return { bars: j.bars.map(x => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] })), prev: j.prev };
}
export async function yahooBars(ticker, tf) {
  const [i, r, rs] = YF[tf];
  const { bars } = await yahooRaw(ticker, i, r);
  return rs ? resample(bars, rs) : bars;
}

// ── Coinbase (for Coinbase premium) ─────────────────────────
export async function coinbaseCandles(product, gran) {
  const j = await getJSON(`/api/proxy?src=cb&p=${product}&g=${gran}`);
  return j.map(x => ({ t: x[0], l: x[1], h: x[2], o: x[3], c: x[4], v: x[5] })).sort((a, b) => a.t - b.t);
}

// ── CoinGecko, Fear & Greed, calendar ──────────────────────
export const cg = (path, params = {}) => getJSON(`/api/proxy?src=cg&path=${encodeURIComponent(path)}&` + new URLSearchParams(params));
export const fngCrypto = () => getJSON('/api/proxy?src=fng');
export const fngHistory = () => getJSON('/api/proxy?src=fnghist');
export const fngStocks = () => getJSON('/api/proxy?src=cnn');
export const calendar = () => getJSON('/api/proxy?src=ff');
