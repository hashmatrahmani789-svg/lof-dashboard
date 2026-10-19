// TradingView-style chart (TradingView Lightweight Charts v5, Apache-2.0) with LOF layers and drawing tools.
import { nyMinutes } from './engine.js';
import { attachDrawing } from './drawing.js';

const LC = window.LightweightCharts;
const OFF = -new Date().getTimezoneOffset() * 60;      // show times in your local time zone
const sh = t => t + OFF;
export const abbr = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  return a >= 1e12 ? s + (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M'
    : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : 0);
};
const UP = '#26a69a', DN = '#ef5350';

const TEMPLATE = `
<div class="lc-wrap">
  <div class="lc-legend"></div>
  <div class="lc-top">
    <button class="lc-btn" data-act="zin" title="Zoom in (+)">＋</button>
    <button class="lc-btn" data-act="zout" title="Zoom out (−)">－</button>
    <button class="lc-btn" data-act="reset" title="Reset view (0)">⟲</button>
    <button class="lc-btn" data-act="fs" title="Full screen (F)">⛶</button>
  </div>
  <div class="lc-hint"></div>
  <div class="lc-tools"></div>
  <div class="lc-c"></div>
</div>`;

// D: {coin, tf, prec, candles:[{time,open,high,low,close}], vol:[], layers:{}, impulseMult, panes:[{key, series:[{kind,name,color,data,cvd,scale}]}],
//     opens:[{title,price,time,color}], plan:[{title,price,color}], levels:[{title,price,color}], asia, profiles}
const THEMES = {
  dark: { bg: '#0f131c', text: '#c3c6ce', grid: '#171c27', border: '#232838', sep: '#232838', sepHover: '#33394a', label: 'rgba(15,19,28,0.85)', box: 'rgba(149,152,161,0.10)', boxLine: 'rgba(149,152,161,0.6)', boxText: '#b2b5be' },
  light: { bg: '#ffffff', text: '#2a2e39', grid: '#eef0f4', border: '#d6dae3', sep: '#d6dae3', sepHover: '#b8bfcc', label: 'rgba(255,255,255,0.9)', box: 'rgba(90,96,110,0.08)', boxLine: 'rgba(90,96,110,0.55)', boxText: '#4a5060' },
};

export function buildChart(host, D) {
  const TH = THEMES[D.theme] || THEMES.dark;
  host.innerHTML = TEMPLATE;
  let dead = false;                         // set when this chart is replaced, so late timers do nothing
  const q = s => host.querySelector(s);
  const wrap = q('.lc-wrap'), el = q('.lc-c'), legend = q('.lc-legend');
  const C = D.candles, L = D.layers || {};
  const STEP = C.length > 1 ? C[C.length - 1].time - C[C.length - 2].time : 60;
  const fmt = p => (p == null || !Number.isFinite(p)) ? '—' : Number(p).toLocaleString('en-US', { minimumFractionDigits: D.prec, maximumFractionDigits: D.prec });

  const chart = LC.createChart(el, {
    autoSize: true,
    localization: { locale: 'en-US' },
    layout: { background: { type: 'solid', color: TH.bg }, textColor: TH.text, fontSize: 12,
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      panes: { separatorColor: TH.sep, separatorHoverColor: TH.sepHover, enableResize: true } },
    grid: { vertLines: { color: TH.grid }, horzLines: { color: TH.grid } },
    crosshair: { mode: LC.CrosshairMode.Normal },
    rightPriceScale: { borderColor: TH.border, minimumWidth: 72 },
    leftPriceScale: { borderColor: TH.border, visible: false },
    timeScale: { borderColor: TH.border, timeVisible: true, secondsVisible: false, rightOffset: 8 },
  });
  const cs = chart.addSeries(LC.CandlestickSeries, {
    upColor: UP, downColor: DN, borderVisible: false, wickUpColor: UP, wickDownColor: DN,
    priceFormat: { type: 'price', precision: D.prec, minMove: Math.pow(10, -D.prec) } }, 0);

  // ── impulse (displacement) candles: body ≥ K × average body of the previous 20 and ≥ 60% of the range
  const K = D.impulseMult || 2.0, N0 = 20;
  function isImpulse(i) {
    if (!L.impulse || i < N0) return false;
    let s = 0; for (let k = i - N0; k < i; k++) s += Math.abs(C[k].close - C[k].open);
    const avg = s / N0, c = C[i], body = Math.abs(c.close - c.open), rng = c.high - c.low;
    return avg > 0 && rng > 0 && body >= K * avg && body / rng >= 0.6;
  }
  function styled(i) {
    const c = C[i], o = { time: sh(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
    if (isImpulse(i)) { const col = c.close > c.open ? '#40c4ff' : '#ff4081'; o.color = col; o.wickColor = col; o.borderColor = col; }
    return o;
  }
  cs.setData(C.map((_, i) => styled(i)));

  // ── EMAs
  const emas = [];
  [[12, 'ema12', '#26c6da'], [21, 'ema21', '#ffb74d'], [50, 'ema50', D.theme === 'light' ? '#5d6273' : '#e0e0e0']].forEach(([n, key, color]) => {
    if (!L[key] || !C.length) return;
    const k = 2 / (n + 1), vals = [];
    C.forEach((c, i) => vals.push(i === 0 ? c.close : c.close * k + vals[i - 1] * (1 - k)));
    const s = chart.addSeries(LC.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, title: '' }, 0);
    s.setData(C.map((c, i) => ({ time: sh(c.time), value: vals[i] })).slice(Math.min(n, C.length - 1)));
    emas.push({ n, k, s, vals });
  });

  // ── price lines (key levels + trade plan)
  let lines = [];
  function drawLines() {
    lines.forEach(pl => cs.removePriceLine(pl)); lines = [];
    // axis labels only; the lines are drawn from where each level starts (see the layers below)
    (D.levels || []).concat(D.plan || []).forEach(l => lines.push(cs.createPriceLine({ price: l.price, color: l.color,
      lineVisible: false, axisLabelVisible: true, title: l.title })));
  }
  drawLines();

  // ── lower panes
  const paneSeries = {};          // key -> [{api, def}]
  (D.panes || []).forEach((p, i) => {
    paneSeries[p.key] = p.series.map(s => {
      const o = { color: s.color, title: s.name, lastValueVisible: true, priceLineVisible: false,
        priceFormat: { type: 'custom', formatter: s.fmt || abbr, minMove: s.minMove || 1 } };
      if (s.scale) o.priceScaleId = s.scale;          // own overlay scale (a second line with its own range)
      const api = s.kind === 'line' ? chart.addSeries(LC.LineSeries, Object.assign(o, { lineWidth: 2 }), i + 1)
        : s.kind === 'candle' ? chart.addSeries(LC.CandlestickSeries, Object.assign(o, { upColor: UP, downColor: DN, borderVisible: false, wickUpColor: UP, wickDownColor: DN }), i + 1)
        : chart.addSeries(LC.HistogramSeries, o, i + 1);
      if (s.scale) api.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      const rec = { api, def: s };
      setSeries(rec, s.data);
      return rec;
    });
  });
  const ps = chart.panes();
  if (ps.length > 1) { ps[0].setStretchFactor(ps.length > 3 ? 2.6 : 2.2); for (let i = 1; i < ps.length; i++) ps[i].setStretchFactor(1); }

  // CVD lines start at 0 on the first visible candle (like Coinalyze)
  function cvdData(raw) {
    if (!raw || !raw.length) return [];
    const r = chart.timeScale().getVisibleLogicalRange();
    const i0 = r ? Math.max(0, Math.min(C.length - 1, Math.ceil(r.from))) : 0;
    const t0 = C.length ? C[i0].time : raw[0].time;
    let j = raw.findIndex(p => p.time >= t0); if (j < 0) j = raw.length - 1;
    const out = new Array(raw.length);
    let acc = 0;
    for (let k = j; k < raw.length; k++) { acc += raw[k].value; out[k] = { time: sh(raw[k].time), value: acc }; }
    acc = 0;
    for (let k = j - 1; k >= 0; k--) { acc -= raw[k + 1].value; out[k] = { time: sh(raw[k].time), value: acc }; }
    return out;
  }
  function setSeries(rec, data) {
    rec.raw = data || [];
    if (rec.def.cvd) rec.api.setData(cvdData(rec.raw));
    else rec.api.setData(rec.raw.map(p => Object.assign({}, p, { time: sh(p.time) })));
  }
  let cvdTimer = null;
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    clearTimeout(cvdTimer);
    cvdTimer = setTimeout(() => { if (!dead) Object.values(paneSeries).flat().forEach(rec => { if (rec.def.cvd) rec.api.setData(cvdData(rec.raw)); }); }, 120);
  });

  // ── helpers shared by layers / drawings
  const RT = () => C.map(c => c.time);
  function timeToLogical(t) {
    const n = C.length; if (!n) return 0;
    if (t <= C[0].time) return (t - C[0].time) / STEP;
    if (t >= C[n - 1].time) return n - 1 + (t - C[n - 1].time) / STEP;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m].time <= t) lo = m; else hi = m; }
    return lo + (t - C[lo].time) / (C[hi].time - C[lo].time);
  }
  function logicalToTime(l) {
    const n = C.length;
    if (l <= 0) return C[0].time + l * STEP;
    if (l >= n - 1) return C[n - 1].time + (l - (n - 1)) * STEP;
    const i = Math.floor(l), f = l - i; return C[i].time + f * (C[i + 1].time - C[i].time);
  }
  // time -> x pixel. Uses whole bars + bar spacing, because the library returns 0 for in-between positions.
  const X = t => {
    const tsc = chart.timeScale(), l = timeToLogical(t), i = Math.floor(l), x0 = tsc.logicalToCoordinate(i);
    return x0 == null ? null : x0 + (l - i) * tsc.options().barSpacing;
  };
  const Y = p => cs.priceToCoordinate(p);
  function hline(ctx, x1, x2, y, color, dash, w) {
    ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
  }
  function text(ctx, s, x, y, color, align) {
    ctx.font = '11px Inter, sans-serif'; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, y); ctx.textAlign = 'left';
  }
  function primitive(z, draw) {
    const p = {
      attached(a) { this.req = a.requestUpdate; }, detached() {}, updateAllViews() {},
      paneViews() { return [{ zOrder: () => z, renderer: () => ({ draw: target => target.useMediaCoordinateSpace(draw) }) }]; },
    };
    cs.attachPrimitive(p);
    return () => p.req && p.req();
  }

  // ── layers: sessions, previous day/week profiles, Asia range, opens
  const nyCache = new Map();
  const sessOf = t => { if (!nyCache.has(t)) nyCache.set(t, nyMinutes(t)); const m = nyCache.get(t); return m >= 120 && m < 300 ? 'L' : m >= 420 && m < 600 ? 'N' : null; };
  function drawProfile(ctx, p, pal, W) {
    const x1 = X(p.start), x2 = X(p.end);
    if (x1 == null || x2 == null || x2 < 0 || x1 > W) return;
    const tot = p.up.map((u, i) => u + p.dn[i]), mx = Math.max(...tot) || 1, width = Math.max(40, (x2 - x1) * 0.35);
    for (let i = 0; i < tot.length; i++) {
      const yt = Y(p.lo + p.step * (i + 1)), yb = Y(p.lo + p.step * i);
      if (yt == null || yb == null) continue;
      const h = Math.max(1, Math.abs(yb - yt) - 1), mid = p.lo + p.step * (i + 0.5), a = mid >= p.val && mid <= p.vah ? pal.a1 : pal.a2;
      const wu = width * p.up[i] / mx, wd = width * p.dn[i] / mx;
      ctx.fillStyle = pal.up.replace('A', a); ctx.fillRect(x1, yt, wu, h);
      ctx.fillStyle = pal.dn.replace('A', a); ctx.fillRect(x1 + wu, yt, wd, h);
    }
    const end = Math.min(x2, W);
    [[p.poc, pal.poc, [], 'POC'], [p.vah, pal.va, [4, 3], 'VAH'], [p.val, pal.va, [4, 3], 'VAL']].forEach(([v, c, d, n]) => {
      const y = Y(v); if (y == null) return;
      hline(ctx, x1, end, y, c, d, n === 'POC' ? 1.5 : 1); text(ctx, `${pal.tag} ${n}`, x1 + 3, y - 3, c);
    });
  }
  const paneW = mediaSize => Math.min(mediaSize.width, chart.timeScale().width() || mediaSize.width);
  const redrawLayers = primitive('bottom', ({ context: ctx, mediaSize }) => {
    const W = paneW(mediaSize), H = mediaSize.height, n = C.length;
    if (L.sessions && STEP <= 3600 && n) {
      const bs = chart.timeScale().options().barSpacing / 2;
      const r = chart.timeScale().getVisibleLogicalRange();
      const a0 = r ? Math.max(0, Math.floor(r.from) - 2) : 0, b0 = r ? Math.min(n - 1, Math.ceil(r.to) + 2) : n - 1;
      let i = a0;
      while (i <= b0) {
        const s = sessOf(C[i].time); if (!s) { i++; continue; }
        let j = i; while (j + 1 <= b0 && sessOf(C[j + 1].time) === s) j++;
        const a = chart.timeScale().logicalToCoordinate(i), b = chart.timeScale().logicalToCoordinate(j);
        if (a != null && b != null) {
          ctx.fillStyle = s === 'L' ? 'rgba(41,98,255,0.07)' : 'rgba(249,168,37,0.07)';
          ctx.fillRect(a - bs, 0, b - a + 2 * bs, H);
          if (b - a + 2 * bs > 58) text(ctx, s === 'L' ? 'London' : 'New York', a - bs + 3, H - 6, s === 'L' ? '#5b7fff' : '#c9952a');
        }
        i = j + 1;
      }
    }
    const P = D.profiles || {};
    if (L.vp_week && P.week) drawProfile(ctx, P.week, { up: 'rgba(171,71,188,A)', dn: 'rgba(171,71,188,A)', a1: 0.38, a2: 0.16, poc: '#ce93d8', va: '#ab47bc', tag: 'W' }, W);
    if (L.vp_day && P.day) drawProfile(ctx, P.day, { up: 'rgba(38,166,154,A)', dn: 'rgba(239,83,80,A)', a1: 0.42, a2: 0.18, poc: '#f9a825', va: '#9598a1', tag: 'D' }, W);
    if (L.asia && D.asia) {
      const a = D.asia, x1 = X(a.start), x2 = X(a.end), yh = Y(a.hi), yl = Y(a.lo);
      if (x1 != null && x2 != null && yh != null && yl != null) {
        ctx.fillStyle = TH.box; ctx.fillRect(x1, yh, x2 - x1, yl - yh);
        ctx.strokeStyle = TH.boxLine; ctx.lineWidth = 1; ctx.strokeRect(x1, yh, x2 - x1, yl - yh);
        hline(ctx, x2, W, yh, TH.boxLine, [3, 3]); hline(ctx, x2, W, yl, TH.boxLine, [3, 3]);
        text(ctx, `Asia H ${fmt(a.hi)}`, x1 + 3, yh - 3, TH.boxText); text(ctx, `Asia L ${fmt(a.lo)}`, x1 + 3, yl + 12, TH.boxText);
      }
    }
    // economic news (CPI, PPI, FOMC, NFP…): dashed vertical line + label at the event time
    if (L.news && D.news && D.news.length && STEP <= 14400) {
      D.news.forEach((ev, k) => {
        const x = X(ev.t); if (x == null || x < 0 || x > W) return;
        const col = ev.impact === 'High' ? '#ef5350' : '#f9a825';
        ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.font = '600 10.5px Inter, sans-serif';
        const lbl = ev.short, w = ctx.measureText(lbl).width + 8, y = 52 + (k % 3) * 16;
        ctx.fillStyle = col; ctx.fillRect(x - w / 2, y - 11, w, 15);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(lbl, x, y); ctx.textAlign = 'left';
      });
    }
    // opens + key levels + trade plan: each line starts where the level was made and runs to the right edge.
    // Levels at the same price share one line and one label.
    const groups = new Map();
    const add = (price, time, title, color, kind) => {
      const k = price.toFixed(D.prec), g = groups.get(k);
      if (g) { g.titles.push(title); g.time = Math.min(g.time, time); if (kind === 'plan') g.kind = 'plan'; }
      else groups.set(k, { price, time, titles: [title], color, kind });
    };
    (D.opens || []).forEach(o => add(o.price, o.time, o.title, o.color, 'open'));
    (D.levels || []).forEach(l => add(l.price, l.time != null ? l.time : C[0].time, l.title, l.color, 'level'));
    const tPlan = C.length ? C[Math.max(0, C.length - 8)].time : 0;
    (D.plan || []).forEach(p => add(p.price, tPlan, p.title, p.color, 'plan'));
    const used = [];
    groups.forEach(g => {
      const y = Y(g.price); if (y == null) return;
      let x = X(g.time); if (x == null) return; x = Math.max(0, x);
      if (x > W) return;
      const plan = g.kind === 'plan';
      hline(ctx, x, W, y, g.color, plan ? (g.titles[0] === 'Entry' ? [] : [8, 4]) : g.kind === 'open' ? [6, 3] : [2, 3], plan ? 2 : 1.2);
      ctx.beginPath(); ctx.fillStyle = g.color; ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
      let ty = y - 3;
      while (used.some(u => Math.abs(u.y - ty) < 11 && Math.abs(u.x - x) < 140)) ty -= 11;
      used.push({ x, y: ty });
      const label = g.titles.join(' · ') + (g.kind === 'open' ? ' ' + fmt(g.price) : '');
      text(ctx, label, x + 5, ty, g.color);
    });
  });

  // ── visible-range volume profile (like TradingView VPVR)
  const VP_ROWS = 48;
  const redrawVP = primitive('bottom', ({ context: ctx, mediaSize }) => {
    if (!L.vp_visible || !D.vol || !D.vol.length) return;
    const r = chart.timeScale().getVisibleLogicalRange(); if (!r) return;
    const a = Math.max(0, Math.ceil(r.from)), b = Math.min(C.length - 1, Math.floor(r.to));
    if (b - a < 3) return;
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i <= b; i++) { lo = Math.min(lo, C[i].low); hi = Math.max(hi, C[i].high); }
    if (!(hi > lo)) return;
    const step = (hi - lo) / VP_ROWS, up = new Array(VP_ROWS).fill(0), dn = new Array(VP_ROWS).fill(0);
    for (let i = a; i <= b; i++) {
      const c = C[i], v = D.vol[i] || 0; if (!v) continue;
      const r0 = Math.min(VP_ROWS - 1, Math.max(0, Math.floor((c.low - lo) / step)));
      const r1 = Math.min(VP_ROWS - 1, Math.max(0, Math.floor((c.high - lo) / step)));
      const shv = v / (r1 - r0 + 1), arr = c.close >= c.open ? up : dn;
      for (let k = r0; k <= r1; k++) arr[k] += shv;
    }
    const tot = up.map((x, i) => x + dn[i]), total = tot.reduce((x, y) => x + y, 0); if (!total) return;
    let poc = 0; tot.forEach((x, i) => { if (x > tot[poc]) poc = i; });
    let u = poc, d = poc, acc = tot[poc];
    while (acc < total * 0.7 && (u < VP_ROWS - 1 || d > 0)) {
      const vu = u < VP_ROWS - 1 ? tot[u + 1] : -1, vd = d > 0 ? tot[d - 1] : -1;
      if (vu >= vd) { u++; acc += vu; } else { d--; acc += vd; }
    }
    const W = paneW(mediaSize), maxW = W * 0.22, mx = tot[poc];
    for (let i = 0; i < VP_ROWS; i++) {
      const yTop = Y(lo + step * (i + 1)), yBot = Y(lo + step * i);
      if (yTop == null || yBot == null) continue;
      const h = Math.max(1, Math.abs(yBot - yTop) - 1), inVA = i >= d && i <= u, wU = maxW * up[i] / mx, wD = maxW * dn[i] / mx;
      ctx.fillStyle = inVA ? 'rgba(38,166,154,0.38)' : 'rgba(38,166,154,0.16)'; ctx.fillRect(W - wU - wD, yTop, wU, h);
      ctx.fillStyle = inVA ? 'rgba(239,83,80,0.38)' : 'rgba(239,83,80,0.16)'; ctx.fillRect(W - wD, yTop, wD, h);
    }
    const yp = Y(lo + step * (poc + 0.5));
    if (yp != null) { hline(ctx, 0, W, yp, '#f9a825', [2, 3]); text(ctx, 'VP POC ' + fmt(lo + step * (poc + 0.5)), W - maxW - 8, yp - 4, '#f9a825', 'right'); }
  });
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => { redrawLayers(); redrawVP(); });

  // ── drawing tools (TradingView-style, saved per market in this browser)
  const drawing = attachDrawing({ chart, cs, el, root: host, C, X, Y, timeToLogical, logicalToTime, fmt, coin: D.coin, primitive, LC, paneW, STEP });

  // ── legend (OHLC of the candle under the mouse)
  function showLegend(i) {
    if (!C.length) return;
    i = i == null || i < 0 || i >= C.length ? C.length - 1 : i;
    const c = C[i], prev = i > 0 ? C[i - 1].close : c.open, ch = (c.close / prev - 1) * 100, col = c.close >= c.open ? UP : DN;
    const v = D.vol && D.vol[i];
    legend.innerHTML = `<b>${D.coin}</b> · ${D.tf} · ${D.source || ''}<br>` +
      `<span>O <i style="color:${col}">${fmt(c.open)}</i></span> <span>H <i style="color:${col}">${fmt(c.high)}</i></span> ` +
      `<span>L <i style="color:${col}">${fmt(c.low)}</i></span> <span>C <i style="color:${col}">${fmt(c.close)}</i></span> ` +
      `<span style="color:${ch >= 0 ? UP : DN}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>` + (v ? ` <span>Vol <i>${abbr(v)}</i></span>` : '');
  }
  chart.subscribeCrosshairMove(param => {
    drawing.onCrosshair(param);
    showLegend(param.logical == null ? null : Math.round(param.logical));
  });
  showLegend();

  // ── zoom / view
  const ts = chart.timeScale();
  function zoom(f) {
    const r = ts.getVisibleLogicalRange(); if (!r) return;
    const w = (r.to - r.from) * f; if (w < 10 || w > C.length * 3) return;
    ts.setVisibleLogicalRange({ from: r.to - w, to: r.to });
  }
  function reset() {
    chart.panes().forEach(p => p.getSeries().forEach(s => s.priceScale().applyOptions({ autoScale: true })));
    ts.setVisibleLogicalRange({ from: Math.max(0, C.length - 150), to: C.length + 6 });
  }
  function fullscreen() {
    const box = host.closest('.chart-card') || wrap;          // the whole card, so timeframe and layer buttons stay usable
    if (document.fullscreenElement) document.exitFullscreen();
    else (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
  }
  q('[data-act=zin]').onclick = () => zoom(0.8);
  q('[data-act=zout]').onclick = () => zoom(1.25);
  q('[data-act=reset]').onclick = reset;
  q('[data-act=reset]').title = 'Reset chart (Alt+R or Ctrl+R)';
  q('[data-act=fs]').onclick = fullscreen;
  let over = false;
  wrap.addEventListener('mouseenter', () => { over = true; });
  wrap.addEventListener('mouseleave', () => { over = false; });
  function scrollBars(n) { const r = ts.getVisibleLogicalRange(); if (r) ts.setVisibleLogicalRange({ from: r.from + n, to: r.to + n }); }
  // TradingView shortcuts (mouse over the chart, or full screen)
  function onKey(e) {
    if (dead || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    if (!over && !(document.fullscreenElement && document.fullscreenElement.contains(wrap))) return;
    if (drawing.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const k = e.key;
    if ((e.altKey || e.ctrlKey || e.metaKey) && e.code === 'KeyR') { e.preventDefault(); e.stopPropagation(); reset(); }      // Alt+R / Ctrl+R reset chart
    else if (k === '+' || k === '=') { e.preventDefault(); zoom(0.8); }
    else if (k === '-' || k === '_') { e.preventDefault(); zoom(1.25); }
    else if (k === '0' && !e.ctrlKey) { e.preventDefault(); reset(); }
    else if (k === 'ArrowLeft') { e.preventDefault(); scrollBars(e.shiftKey ? -20 : -3); }
    else if (k === 'ArrowRight') { e.preventDefault(); scrollBars(e.shiftKey ? 20 : 3); }
    else if (k === 'ArrowUp' && !e.shiftKey) { e.preventDefault(); zoom(0.85); }
    else if (k === 'ArrowDown' && !e.shiftKey) { e.preventDefault(); zoom(1.18); }
    else if (k === 'Home' || (e.altKey && e.code === 'KeyG')) { e.preventDefault(); ts.scrollToRealTime(); }
  }
  window.addEventListener('keydown', onKey, true);

  // drag inside a pane also moves it up/down (TradingView-style); double-click the price axis to auto-scale again
  function paneAt(y) { let top = 0; for (const p of chart.panes()) { const h = p.getHeight(); if (y >= top && y < top + h) return { p, h }; top += h + 1; } return null; }
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drawing.busy() || e.shiftKey) return;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > r.width - cs.priceScale().width() || y > r.height - ts.height()) return;
    const hit = paneAt(y); if (!hit) return;
    const ser = hit.p.getSeries()[0]; if (!ser) return;
    const psc = ser.priceScale(), vr = psc.getVisibleRange(); if (!vr) return;
    drag = { ps: psc, vr, y0: e.clientY, h: hit.h, moved: false };
  }, true);
  const onMove = e => {
    if (!drag || !(e.buttons & 1)) return;
    const dy = e.clientY - drag.y0; if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    const shift = dy * (drag.vr.to - drag.vr.from) / drag.h, target = { from: drag.vr.from + shift, to: drag.vr.to + shift };
    drag.ps.applyOptions({ autoScale: false }); drag.ps.setVisibleRange(target);
    requestAnimationFrame(() => { if (drag && !dead) drag.ps.setVisibleRange(target); });
  };
  const onUp = () => { drag = null; };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  // wheel over the price axis stretches / squeezes that pane
  el.addEventListener('wheel', e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < r.width - cs.priceScale().width()) return;
    const hit = paneAt(y); if (!hit) return;
    const ser = hit.p.getSeries()[0]; if (!ser) return;
    const psc = ser.priceScale(), vr = psc.getVisibleRange(); if (!vr) return;
    e.preventDefault(); e.stopPropagation();
    const f = e.deltaY > 0 ? 1.1 : 1 / 1.1, mid = (vr.from + vr.to) / 2, half = (vr.to - vr.from) / 2 * f;
    psc.applyOptions({ autoScale: false }); psc.setVisibleRange({ from: mid - half, to: mid + half });
  }, { capture: true, passive: false });

  // remember zoom / scroll per market + timeframe
  const VKEY = 'lof_view_' + D.coin + '_' + D.tf;
  try {
    const sv = JSON.parse(localStorage.getItem(VKEY) || 'null');
    if (sv && Date.now() - sv.ts < 6 * 3600e3 && sv.r2 > -60 && sv.r1 - sv.r2 >= 10) ts.setVisibleLogicalRange({ from: C.length - sv.r1, to: C.length - sv.r2 });
    else ts.setVisibleLogicalRange({ from: Math.max(0, C.length - 150), to: C.length + 6 });
  } catch (e) { /* ignore */ }
  ts.subscribeVisibleLogicalRangeChange(r => {
    if (!r) return;
    if (r.from < 15 && D.onNeedHistory && !dead) setTimeout(() => { if (!dead) D.onNeedHistory(); }, 0);      // scrolled to the left edge: load older candles
    try { localStorage.setItem(VKEY, JSON.stringify({ r1: C.length - r.from, r2: C.length - r.to, ts: Date.now() })); } catch (e) { /* ignore */ }
  });

  // ── public API
  const api = {
    chart, cs,
    // live candle from the websocket: {t,o,h,l,c,v}
    update(bar) {
      if (dead) return;
      const n = C.length; if (!n) return;
      const lastT = C[n - 1].time;
      if (bar.t < lastT) return;
      const c = { time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
      const isNew = bar.t > lastT;
      if (isNew) { C.push(c); if (D.vol) D.vol.push(bar.v || 0); } else { C[n - 1] = c; if (D.vol) D.vol[n - 1] = bar.v || 0; }
      const i = C.length - 1;
      try { cs.update(styled(i)); } catch (e) { return; }
      emas.forEach(m => {
        const v = i === 0 ? c.close : c.close * m.k + m.vals[i - 1] * (1 - m.k);
        if (isNew) m.vals.push(v); else m.vals[i] = v;
        if (i >= m.n) m.s.update({ time: sh(c.time), value: v });
      });
      const vol = paneSeries.vol;
      if (vol && vol[0]) {
        const pt = { time: bar.t, value: bar.v || 0, color: c.close >= c.open ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)' };
        if (isNew) vol[0].raw.push(pt); else vol[0].raw[vol[0].raw.length - 1] = pt;
        vol[0].api.update(Object.assign({}, pt, { time: sh(pt.time) }));
        if (vol[1]) {
          const raw = vol[0].raw, k = raw.length;
          if (k >= 20) {
            let s = 0; for (let j = k - 20; j < k; j++) s += raw[j].value;
            const m = { time: bar.t, value: s / 20 };
            if (isNew) vol[1].raw.push(m); else vol[1].raw[vol[1].raw.length - 1] = m;
            vol[1].api.update({ time: sh(m.time), value: m.value });
          }
        }
      }
      showLegend();
      redrawVP();
    },
    setPane(key, idx, data) { if (dead) return; const p = paneSeries[key]; if (p && p[idx]) setSeries(p[idx], data); },
    hasPane: key => !!paneSeries[key],
    setOverlays(o) { if (dead) return; Object.assign(D, o); drawLines(); redrawLayers(); },
    lastTime: () => (C.length ? C[C.length - 1].time : 0),
    fullscreen,
    destroy() {
      dead = true; clearTimeout(cvdTimer); drawing.destroy();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      try { chart.remove(); } catch (e) { /* ignore */ }
      host.innerHTML = '';
    },
  };
  return api;
}
