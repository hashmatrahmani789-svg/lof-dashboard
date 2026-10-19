// Coinalyze order-flow data for one coin, aggregated across the main exchanges, cached on the server.
// GET /api/cz?sym=BTCUSDT&tf=15m&bars=400&snap=1&liq=1&parts=oi,perp,spot
import { cached, send, query, cz, callsLastMinute } from './_lib.js';

const TF = { '5m': ['5min', 300], '15m': ['15min', 900], '30m': ['30min', 1800], '1h': ['1hour', 3600],
  '2h': ['2hour', 7200], '4h': ['4hour', 14400], '12h': ['12hour', 43200], '1D': ['daily', 86400] };
const PERP_PREF = ['binance', 'bybit', 'okx', 'bitget', 'hyperliquid', 'gate', 'deribit', 'bitmex', 'bingx', 'mexc', 'kucoin', 'htx', 'huobi'];
const SPOT_PREF = ['binance', 'coinbase', 'bybit', 'okx', 'kraken', 'bitget'];
const SPOT_QUOTES = new Set(['USDT', 'USD', 'USDC', 'FDUSD']);
const MAX_FLOW = 6, MAX_SPOTS = 3, MAX_LIQ = 3, MAX_FUNDING = 4;   // OI uses up to n markets (6–20); CVD uses the top 6

const rank = (name, pref) => { const n = (name || '').toLowerCase(); const i = pref.findIndex(p => n.includes(p)); return i < 0 ? 99 : i; };

async function markets() {
  return cached('cz:markets', 12 * 3600e3, async () => {
    const [ex, fut, spot] = await Promise.all([cz('exchanges'), cz('future-markets'), cz('spot-markets')]);
    const names = Object.fromEntries(ex.map(e => [e.code, e.name]));
    return { names, fut, spot };
  });
}

function pick({ names, fut, spot }, sym, maxPerps) {
  const exName = m => names[m.exchange] || m.exchange;
  const main = fut.find(m => m.is_perpetual && /binance/i.test(exName(m)) && m.symbol_on_exchange === sym)
            || fut.find(m => m.is_perpetual && m.symbol_on_exchange === sym);
  const base = main ? main.base_asset : sym.replace(/(USDT|USDC|USD)$/, '').replace(/^1000+/, '');
  // Perps for OI: the biggest exchanges first, every contract type (USDT, coin-margined, USDC), then other exchanges.
  const kind = m => m.margined === 'STABLE' ? (m.quote_asset === 'USDT' ? 0 : 2) : 1;
  const all = fut.filter(m => m.base_asset === base && m.is_perpetual)
    .sort((a, b) => rank(exName(a), PERP_PREF) - rank(exName(b), PERP_PREF) || kind(a) - kind(b));
  // first pass: one main contract per top exchange, so a small n still covers the most exchanges
  const perps = [], seen = new Set();
  all.forEach(m => { if (perps.length < maxPerps && !seen.has(m.exchange) && rank(exName(m), PERP_PREF) < 99) { seen.add(m.exchange); perps.push(m); } });
  all.forEach(m => { if (perps.length < maxPerps && !perps.includes(m)) perps.push(m); });
  if (main && !perps.includes(main)) { perps.unshift(main); if (perps.length > maxPerps) perps.pop(); }
  if (main) { perps.splice(perps.indexOf(main), 1); perps.unshift(main); }
  const spots = [], seenS = new Set();
  spot.filter(m => m.base_asset === base && SPOT_QUOTES.has(m.quote_asset) && m.has_buy_sell_data)
    .sort((a, b) => rank(exName(a), SPOT_PREF) - rank(exName(b), SPOT_PREF))
    .forEach(m => {
      if (seenS.has(m.exchange) || spots.length >= MAX_SPOTS || rank(exName(m), SPOT_PREF) === 99) return;
      seenS.add(m.exchange); spots.push(m);
    });
  const info = m => ({ symbol: m.symbol, exchange: exName(m), pair: m.symbol_on_exchange,
    margin: m.margined === 'STABLE' ? (m.quote_asset || 'USDT') : m.margined === 'COIN' ? 'coin' : (m.margined || ''),
    denom: m.oi_lq_vol_denominated_in || 'BASE_ASSET', ls: !!m.has_long_short_ratio_data, flow: !!m.has_buy_sell_data });
  return { base, perps: perps.map(info), spots: spots.map(info) };
}

const hist = arr => Object.fromEntries((arr || []).map(x => [x.symbol, (x.history || []).slice().sort((a, b) => a.t - b.t)]));

function sumOI(by) {
  // Sum open-interest candles across exchanges (USD). Repair bad highs/lows, forward-fill gaps.
  const series = Object.values(by).filter(h => h.length);
  if (!series.length) return [];
  const start = Math.max(...series.map(h => h[0].t));
  const times = [...new Set(series.flatMap(h => h.map(x => x.t)))].filter(t => t >= start).sort((a, b) => a - b);
  const out = times.map(t => [t, 0, 0, 0, 0]);
  series.forEach(h => {
    let j = 0, last = null;
    times.forEach((t, i) => {
      while (j < h.length && h[j].t <= t) { last = h[j]; j++; }
      if (!last) return;
      const o = +last.o, c = +last.c, hi0 = +last.h, lo0 = +last.l;
      const hi = hi0 >= Math.max(o, c) ? hi0 : Math.max(o, c);
      const lo = lo0 > 0 && lo0 <= Math.min(o, c) ? lo0 : Math.min(o, c);
      const same = last.t === t;
      out[i][1] += same ? o : c; out[i][2] += same ? hi : c; out[i][3] += same ? lo : c; out[i][4] += c;
    });
  });
  return out;
}

function sumDelta(by, denomOf) {
  // Taker buy minus taker sell, in USD, summed across markets: delta = 2*buyVol - totalVol
  const m = new Map();
  for (const [sym, h] of Object.entries(by)) {
    const base = denomOf(sym) === 'BASE_ASSET';
    for (const x of h) {
      if (x.bv == null || x.v == null) continue;
      const k = base ? +x.c : 1;
      const cur = m.get(x.t) || [0, 0];
      cur[0] += (2 * x.bv - x.v) * k; cur[1] += x.v * k;
      m.set(x.t, cur);
    }
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, [d, v]]) => [t, Math.round(d), Math.round(v)]);
}

function sumLiq(by) {
  const m = new Map();
  for (const h of Object.values(by)) for (const x of h) {
    const cur = m.get(x.t) || [0, 0]; cur[0] += +x.l || 0; cur[1] += +x.s || 0; m.set(x.t, cur);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, [l, s]]) => [t, Math.round(l), Math.round(s)]);
}

function fundingScale(vals) {
  const v = vals.filter(x => x != null && !Number.isNaN(x)).map(Math.abs).sort((a, b) => a - b);
  if (!v.length) return 1;
  return v[Math.floor(v.length / 2)] < 0.002 ? 100 : 1;     // decimal → percent
}

async function load(sym, tf, bars, snap, liq, parts, n) {
  const mk = await markets();
  const sel = pick(mk, sym, n);
  if (!sel.perps.length) throw Object.assign(new Error(`Coinalyze has no perpetual markets for ${sym}.`), { status: 404 });
  const [interval, sec] = TF[tf];
  const now = Math.floor(Date.now() / 1000);
  const span = { interval, from: now - sec * bars, to: now };
  const perpSyms = sel.perps.map(p => p.symbol);
  const flowSyms = sel.perps.filter(p => p.flow).slice(0, MAX_FLOW).map(p => p.symbol);
  const spotSyms = sel.spots.map(p => p.symbol);
  const main = sel.perps[0];
  const lsSym = (sel.perps.find(p => p.ls) || {}).symbol;
  const jobs = {
    oi: parts.has('oi') || snap ? cz('open-interest-history', { symbols: perpSyms.join(','), ...span, convert_to_usd: 'true' }) : [],
    perp: parts.has('perp') && flowSyms.length ? cz('ohlcv-history', { symbols: flowSyms.join(','), ...span }) : [],
    spot: parts.has('spot') && spotSyms.length ? cz('ohlcv-history', { symbols: spotSyms.join(','), ...span }) : [],
  };
  const liqSyms = sel.perps.filter(p => p.margin !== 'coin').slice(0, MAX_LIQ).map(p => p.symbol);
  if (liq) jobs.liq = cz('liquidation-history', { symbols: liqSyms.join(','), ...span, convert_to_usd: 'true' });
  if (snap) {
    jobs.funding = cz('funding-rate', { symbols: perpSyms.slice(0, MAX_FUNDING).join(',') });
    jobs.pred = cz('predicted-funding-rate', { symbols: main.symbol });
    if (lsSym) jobs.ls = cz('long-short-ratio-history', { symbols: lsSym, interval: '1hour', from: now - 26 * 3600, to: now });
  }
  const keys = Object.keys(jobs);
  const vals = await Promise.all(keys.map(k => Promise.resolve(jobs[k])));
  const R = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));

  const denomOf = s => (sel.perps.find(p => p.symbol === s) || {}).denom || 'BASE_ASSET';
  const oiBy = hist(R.oi);
  const lastOI = Object.fromEntries(Object.entries(oiBy).map(([s, h]) => [s, h.length ? +h[h.length - 1].c : 0]));
  const out = {
    sym, base: sel.base, tf, at: now,
    perps: sel.perps.map(p => ({ ...p, oi: lastOI[p.symbol] || 0, cvd: flowSyms.includes(p.symbol) })), spots: sel.spots,
    oi: sumOI(oiBy),
    perp: sumDelta(hist(R.perp), denomOf),
    spot: sumDelta(hist(R.spot), () => 'BASE_ASSET'),
  };
  if (liq) { out.liq = sumLiq(hist(R.liq)); out.liqMarkets = liqSyms.length; }
  if (snap) {
    const f = Object.fromEntries((R.funding || []).map(d => [d.symbol, d.value]));
    const sc = fundingScale(Object.values(f));
    let num = 0, den = 0;
    const fundingBy = {};
    for (const [s, v] of Object.entries(f)) {
      if (v == null) continue;
      fundingBy[s] = v * sc;
      const w = lastOI[s] || 0; num += v * sc * w; den += w;
    }
    const pv = (R.pred || []).map(d => d.value).filter(v => v != null);
    const lsH = R.ls ? (hist(R.ls)[lsSym] || []) : [];
    out.snap = {
      funding: den ? num / den : null, fundingBy,
      pred: pv.length ? pv[0] * fundingScale(pv) : null,
      ls: lsH.length ? +lsH[lsH.length - 1].r : null, lsExchange: lsSym ? (sel.perps.find(p => p.symbol === lsSym) || {}).exchange : null,
    };
  }
  return out;
}

export default async function handler(req, res) {
  const q = query(req);
  const sym = String(q.sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const tf = TF[q.tf] ? q.tf : '15m';
  const bars = Math.min(Math.max(parseInt(q.bars || '400', 10) || 400, 50), 1000);
  const snap = q.snap === '1', liq = q.liq === '1';
  const n = Math.min(Math.max(parseInt(q.n || '12', 10) || 12, 3), 20);
  const parts = new Set(String(q.parts || 'oi,perp,spot').split(',').filter(x => ['oi', 'perp', 'spot'].includes(x)));
  if (!sym) return send(res, 400, { error: 'sym is required, e.g. BTCUSDT' });
  const ttl = TF[tf][1] <= 900 ? 60 : 120;
  try {
    const data = await cached(`cz:${sym}:${tf}:${bars}:${snap}:${liq}:${[...parts].sort()}:${n}`, ttl * 1000, () => load(sym, tf, bars, snap, liq, parts, n));
    send(res, 200, { ...data, calls: callsLastMinute() }, ttl);
  } catch (e) {
    send(res, e.status && e.status < 600 ? e.status : 502, { error: String(e.message || e), calls: callsLastMinute() });
  }
}
