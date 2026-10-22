// Indicators computed on the chart's candles. Every calc(from) fills its arrays from index `from` to the end,
// using only the values at from-1, so a live candle only recomputes the last bar.
// C: [{time, open, high, low, close}], V: volumes (same index)
import { nyMinutes } from './engine.js';

const DAY = 86400;
const wk = t => Math.floor((t / DAY + 3) / 7);            // week number, Monday start (UTC)

export function makeIndicators(C, V, cfg, colors) {
  const list = [];
  const n = () => C.length;
  // ── EMA family
  const emaStep = (src, out, len, i) => { const k = 2 / (len + 1); out[i] = i === 0 ? src[i] : src[i] * k + out[i - 1] * (1 - k); };
  if (cfg.ema200) {
    const close = [], e = [];
    list.push({ key: 'ema200', name: 'EMA 200', pane: 0, legend: true, min: 200,
      lines: [{ color: colors.ema200, width: 1.5, vals: e }],
      calc(from) { for (let i = from; i < n(); i++) { close[i] = C[i].close; emaStep(close, e, 200, i); } } });
  }
  [[15, 'tema15'], [30, 'tema30']].forEach(([len, key]) => {
    if (!cfg[key]) return;
    const close = [], e1 = [], e2 = [], e3 = [], out = [];
    list.push({ key, name: 'TEMA ' + len, pane: 0, legend: true, min: len * 3,
      lines: [{ color: colors[key], width: 1.5, vals: out }],
      calc(from) {
        for (let i = from; i < n(); i++) {
          close[i] = C[i].close; emaStep(close, e1, len, i); emaStep(e1, e2, len, i); emaStep(e2, e3, len, i);
          out[i] = 3 * e1[i] - 3 * e2[i] + e3[i];
        }
      } });
  });
  // ── ATR (Wilder) — used by Supertrend and the ATR pane
  function atrCalc(len, tr, atr, from) {
    for (let i = from; i < n(); i++) {
      const c = C[i], pc = i ? C[i - 1].close : c.close;
      tr[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
      atr[i] = i < len ? ((i ? atr[i - 1] * i : 0) + tr[i]) / (i + 1) : (atr[i - 1] * (len - 1) + tr[i]) / len;
    }
  }
  if (cfg.st) {
    const len = cfg.stLen || 10, mult = cfg.stMult || 3, tr = [], atr = [], fu = [], fl = [], dir = [], up = [], dn = [];
    list.push({ key: 'st', name: `Supertrend ${len} ${mult}`, pane: 0, legend: true, min: len,
      lines: [{ color: colors.stUp, width: 2, vals: up }, { color: colors.stDn, width: 2, vals: dn }],
      value: i => dir[i] === 1 ? fl[i] : fu[i], valueColor: i => dir[i] === 1 ? colors.stUp : colors.stDn,
      calc(from) {
        atrCalc(len, tr, atr, from);
        for (let i = from; i < n(); i++) {
          const c = C[i], hl2 = (c.high + c.low) / 2, ub = hl2 + mult * atr[i], lb = hl2 - mult * atr[i];
          if (i === 0) { fu[i] = ub; fl[i] = lb; dir[i] = 1; }
          else {
            const pc = C[i - 1].close;
            fu[i] = ub < fu[i - 1] || pc > fu[i - 1] ? ub : fu[i - 1];
            fl[i] = lb > fl[i - 1] || pc < fl[i - 1] ? lb : fl[i - 1];
            dir[i] = dir[i - 1] === 1 ? (c.close < fl[i] ? -1 : 1) : (c.close > fu[i] ? 1 : -1);
          }
          up[i] = dir[i] === 1 ? fl[i] : null;
          dn[i] = dir[i] === -1 ? fu[i] : null;
        }
      } });
  }
  // ── VWAP: daily and weekly (reset at 00:00 UTC / Monday), plus anchored to the recent swing high and swing low
  const vwap = (key, name, color, anchorOf) => {
    const pv = [], vv = [], out = [];
    list.push({ key, name, pane: 0, legend: true, min: 0, lines: [{ color, width: 1.5, vals: out, dash: true }],
      calc(from) {
        for (let i = from; i < n(); i++) {
          const c = C[i], tp = (c.high + c.low + c.close) / 3, v = V[i] || 0, reset = i === 0 || anchorOf(C[i].time) !== anchorOf(C[i - 1].time);
          pv[i] = (reset ? 0 : pv[i - 1]) + tp * v; vv[i] = (reset ? 0 : vv[i - 1]) + v;
          out[i] = vv[i] > 0 ? pv[i] / vv[i] : tp;
        }
      } });
  };
  if (cfg.vwapD) vwap('vwapD', 'VWAP D', colors.vwapD, t => Math.floor(t / DAY));
  if (cfg.vwapW) vwap('vwapW', 'VWAP W', colors.vwapW, wk);
  if (cfg.vwapS) {
    const hiOut = [], loOut = [];
    list.push({ key: 'vwapS', name: 'AVWAP swing', pane: 0, legend: false, min: 0, full: true,
      lines: [{ color: colors.vwapSH, width: 1.5, vals: hiOut }, { color: colors.vwapSL, width: 1.5, vals: loOut }],
      calc() {
        // anchor: highest high and lowest low of the last 150 candles
        hiOut.length = 0; loOut.length = 0;
        const N = n(), a = Math.max(0, N - 150); if (N < 3) return;
        let ih = a, il = a;
        for (let i = a; i < N; i++) { if (C[i].high > C[ih].high) ih = i; if (C[i].low < C[il].low) il = i; }
        [[ih, hiOut], [il, loOut]].forEach(([s, out]) => {
          let pv = 0, vv = 0;
          for (let i = s; i < N; i++) { const c = C[i], tp = (c.high + c.low + c.close) / 3, v = V[i] || 0; pv += tp * v; vv += v; out[i] = vv ? pv / vv : tp; }
        });
      } });
  }
  // ── RSI (Wilder) with divergence marks
  if (cfg.rsi) {
    const len = cfg.rsiLen || 14, ag = [], al = [], out = [];
    list.push({ key: 'rsi', name: 'RSI ' + len, pane: 'rsi', legend: false, min: len, levels: [70, 50, 30],
      lines: [{ color: colors.rsi, width: 1.5, vals: out }],
      calc(from) {
        for (let i = Math.max(1, from); i < n(); i++) {
          const ch = C[i].close - C[i - 1].close, g = Math.max(ch, 0), l = Math.max(-ch, 0);
          if (i <= len) { ag[i] = ((ag[i - 1] || 0) * (i - 1) + g) / i; al[i] = ((al[i - 1] || 0) * (i - 1) + l) / i; }
          else { ag[i] = (ag[i - 1] * (len - 1) + g) / len; al[i] = (al[i - 1] * (len - 1) + l) / len; }
          out[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]);
        }
        if (from === 0) out[0] = 50;
      },
      // regular divergences on confirmed pivots (5 bars each side), last 400 candles
      divergences() {
        if (!cfg.rsiDiv) return [];
        const P = 5, N = n(), a = Math.max(len + P, N - 400), res = [];
        const isLow = i => { for (let k = 1; k <= P; k++) if (C[i].low > C[i - k].low || C[i].low > C[i + k].low) return false; return true; };
        const isHigh = i => { for (let k = 1; k <= P; k++) if (C[i].high < C[i - k].high || C[i].high < C[i + k].high) return false; return true; };
        let pl = null, ph = null;
        for (let i = a; i < N - P; i++) {
          if (isLow(i)) {
            if (pl != null && i - pl <= 60 && C[i].low < C[pl].low && out[i] > out[pl] && out[i] < 50) res.push({ i, j: pl, bull: true });
            pl = i;
          }
          if (isHigh(i)) {
            if (ph != null && i - ph <= 60 && C[i].high > C[ph].high && out[i] < out[ph] && out[i] > 50) res.push({ i, j: ph, bull: false });
            ph = i;
          }
        }
        return res;
      } });
  }
  // ── MACD (fast EMA − slow EMA, signal EMA, histogram in 4 colours like TradingView) with optional cross arrows
  if (cfg.macd) {
    const f = cfg.macdFast || 12, sl = cfg.macdSlow || 26, sg = cfg.macdSig || 9;
    const close = [], ef = [], es = [], m = [], sig = [], h = [];
    list.push({ key: 'macd', name: `MACD ${f} ${sl} ${sg}`, pane: 'macd', legend: false, min: sl, levels: [0],
      lines: [{ hist: true, vals: h, color: colors.macdHistUp, colorAt: i => {
          const up = h[i] >= 0, grow = i > 0 && (up ? h[i] >= h[i - 1] : h[i] <= h[i - 1]);
          return up ? (grow ? colors.macdHistUp : colors.macdHistUp2) : (grow ? colors.macdHistDn : colors.macdHistDn2); } },
        { color: colors.macd, width: 1.5, vals: m }, { color: colors.macdSig, width: 1.5, vals: sig }],
      calc(from) {
        for (let i = from; i < n(); i++) {
          close[i] = C[i].close; emaStep(close, ef, f, i); emaStep(close, es, sl, i);
          m[i] = ef[i] - es[i]; emaStep(m, sig, sg, i); h[i] = m[i] - sig[i];
        }
      },
      markers() {
        if (!cfg.macdCross) return [];
        const out = [], a = Math.max(sl + sg, n() - 500);
        for (let i = a; i < n() - 1; i++) {           // closed candles only
          if (h[i - 1] < 0 && h[i] >= 0) out.push({ i, bull: true, text: 'MACD ↑' });
          else if (h[i - 1] > 0 && h[i] <= 0) out.push({ i, bull: false, text: 'MACD ↓' });
        }
        return out;
      } });
  }
  if (cfg.atr) {
    const len = cfg.atrLen || 14, tr = [], out = [];
    list.push({ key: 'atr', name: 'ATR ' + len, pane: 'atr', legend: false, min: len,
      lines: [{ color: colors.atr, width: 1.5, vals: out }], calc(from) { atrCalc(len, tr, out, from); } });
  }
  return list;
}

// ── Fair value gaps (3-candle imbalance). Returns open gaps and recently filled ones.
export function fairValueGaps(C, maxOpen = 20) {
  const N = C.length, a = Math.max(2, N - 600), out = [];
  if (N < 5) return out;
  let avg = 0; for (let i = Math.max(1, N - 100); i < N; i++) avg += C[i].high - C[i].low; avg /= Math.min(99, N - 1);
  const minGap = avg * 0.15;
  for (let i = a; i < N; i++) {
    const p = C[i - 2], c = C[i];
    let g = null;
    if (c.low > p.high && c.low - p.high >= minGap) g = { bull: true, top: c.low, bot: p.high };
    else if (c.high < p.low && p.low - c.high >= minGap) g = { bull: false, top: p.low, bot: c.high };
    if (!g) continue;
    g.t = C[i - 1].time; g.end = null;
    for (let j = i + 1; j < N; j++) {
      if (g.bull ? C[j].low <= g.bot : C[j].high >= g.top) { g.end = C[j].time; g.ej = j; break; }
      if (g.bull) g.top = Math.min(g.top, Math.max(g.bot, C[j].low)); else g.bot = Math.max(g.bot, Math.min(g.top, C[j].high));
    }
    if (g.end == null || N - g.ej < 40) out.push(g);
  }
  const open = out.filter(g => g.end == null).slice(-maxOpen), filled = out.filter(g => g.end != null).slice(-maxOpen);
  return open.concat(filled);
}

// ── Session highs / lows (Asia 20:00–00:00, London 02:00–05:00, New York 07:00–10:00, New York time).
// Each line runs from the session end until price trades through it (swept) or to the right edge.
const SESS = [['Asia', 1200, 1440], ['LDN', 120, 300], ['NY', 420, 600]];
export function sessionLevels(C, days = 5) {
  const N = C.length, out = [];
  if (N < 3) return out;
  const a = Math.max(0, N - Math.ceil(days * 86400 / Math.max(60, C[N - 1].time - C[N - 2].time)) - 2);
  let cur = null;
  const flush = () => { if (cur) out.push(cur); cur = null; };
  for (let i = a; i < N; i++) {
    const m = nyMinutes(C[i].time), s = SESS.find(([, f, t]) => m >= f && m < t);
    if (!s) { flush(); continue; }
    if (!cur || cur.name !== s[0] || C[i].time - C[i - 1].time > 4 * 3600) { flush(); cur = { name: s[0], hi: -Infinity, lo: Infinity, t0: C[i].time, i0: i }; }
    cur.hi = Math.max(cur.hi, C[i].high); cur.lo = Math.min(cur.lo, C[i].low); cur.i1 = i; cur.t1 = C[i].time;
  }
  if (cur) { cur.live = true; out.push(cur); }
  out.forEach(s => {
    s.hiEnd = null; s.loEnd = null;
    for (let j = s.i1 + 1; j < N; j++) {
      if (s.hiEnd == null && C[j].high > s.hi) s.hiEnd = C[j].time;
      if (s.loEnd == null && C[j].low < s.lo) s.loEnd = C[j].time;
      if (s.hiEnd != null && s.loEnd != null) break;
    }
  });
  return out.slice(-days * 3);
}

// ── Liquidity pools: equal highs / lows (EQH / EQL) and untaken swing highs / lows (BSL / SSL).
// A line runs right while the liquidity is still there; once price trades through it, it stops at that candle (swept ✓).
export function liquidityPools(C, { eq = true, swing = true, piv = 3, major = 8, tolAtr = 0.15, maxEach = 6 } = {}) {
  const N = C.length, out = [];
  if (N < 30) return out;
  const a = Math.max(major, N - 800);
  let atr = 0; for (let i = Math.max(1, N - 100); i < N; i++) atr += Math.max(C[i].high - C[i].low, Math.abs(C[i].high - C[i - 1].close), Math.abs(C[i].low - C[i - 1].close));
  atr /= Math.min(99, N - 1);
  const tol = atr * tolAtr;
  const isPH = (i, p) => { for (let k = 1; k <= p; k++) if (i - k < 0 || i + k >= N || C[i].high < C[i - k].high || C[i].high <= C[i + k].high) return false; return true; };
  const isPL = (i, p) => { for (let k = 1; k <= p; k++) if (i - k < 0 || i + k >= N || C[i].low > C[i - k].low || C[i].low >= C[i + k].low) return false; return true; };
  const sweepAfter = (from, price, high) => { for (let j = from + 1; j < N; j++) if (high ? C[j].high > price : C[j].low < price) return j; return -1; };
  if (eq) {
    [[true, isPH, 'EQH'], [false, isPL, 'EQL']].forEach(([high, isP, tag]) => {
      const piv2 = []; for (let i = a; i < N - piv; i++) if (isP(i, piv)) piv2.push(i);
      const used = new Set(), res = [];
      for (let x = piv2.length - 1; x >= 0; x--) {
        const i = piv2[x]; if (used.has(i)) continue;
        const pi = high ? C[i].high : C[i].low, grp = [i];
        // earlier pivots at (almost) the same price, with no candle in between trading through the group
        for (let y = x - 1; y >= 0 && piv2[x] - piv2[y] <= 150; y--) {
          const j = piv2[y], pj = high ? C[j].high : C[j].low;
          if (Math.abs(pj - pi) > tol) continue;
          const lvl = high ? Math.max(pi, pj) : Math.min(pi, pj);
          let broken = false; for (let k = j + 1; k < grp[grp.length - 1]; k++) if (high ? C[k].high > lvl + tol * 0.5 : C[k].low < lvl - tol * 0.5) { broken = true; break; }
          if (!broken) grp.push(j);
        }
        if (grp.length < 2) continue;
        grp.forEach(g => used.add(g));
        const first = Math.min(...grp), last = Math.max(...grp);
        const price = high ? Math.max(...grp.map(g => C[g].high)) : Math.min(...grp.map(g => C[g].low));
        const sj = sweepAfter(last, price, high);
        if (sj >= 0 && N - sj > 120) continue;
        res.push({ kind: tag, high, price, t0: C[first].time, n: grp.length, end: sj >= 0 ? C[sj].time : null });
      }
      out.push(...res.filter(r => r.end == null).slice(0, maxEach), ...res.filter(r => r.end != null).slice(0, 3));
    });
  }
  if (swing) {
    [[true, isPH, 'BSL'], [false, isPL, 'SSL']].forEach(([high, isP, tag]) => {
      const res = [];
      for (let i = N - major - 1; i >= a && res.length < maxEach + 3; i--) {
        if (!isP(i, major)) continue;
        const price = high ? C[i].high : C[i].low, sj = sweepAfter(i, price, high);
        if (sj >= 0 && N - sj > 60) continue;
        if (out.some(o => o.high === high && Math.abs(o.price - price) <= tol)) continue;      // already shown as EQH / EQL
        res.push({ kind: tag, high, price, t0: C[i].time, n: 1, end: sj >= 0 ? C[sj].time : null });
      }
      out.push(...res.filter(r => r.end == null).slice(0, maxEach), ...res.filter(r => r.end != null).slice(0, 2));
    });
  }
  return out;
}
