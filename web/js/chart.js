// TradingView-style chart (TradingView Lightweight Charts v5, Apache-2.0) with LOF layers and drawing tools.
import { nyMinutes } from './engine.js';
import { attachDrawing } from './drawing.js';
import { makeIndicators, fairValueGaps, sessionLevels } from './indicators.js';

const LC = window.LightweightCharts;
// The chart library has no time zones: each chart shifts its times by the chosen zone's offset (see buildChart).
export function tzOffset(tz) {
  if (!tz || tz === 'local') return -new Date().getTimezoneOffset() * 60;
  const d = new Date(), p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 1000);
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');
const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const abbr = v => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  return a >= 1e12 ? s + (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(2) + 'M'
    : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'K' : s + a.toFixed(a < 10 ? 2 : 0);
};
// colours you can change in Settings → Colours
export const DEFAULT_COLORS = {
  up: '#26a69a', dn: '#ef5350',
  imp1: '#ffa726', imp2: '#26c6da', imp3: '#1e1eff',
  ema12: '#26c6da', ema21: '#ffb74d', ema50: '#e0e0e0', ema200: '#ab47bc', tema15: '#00e676', tema30: '#ff5252',
  stUp: '#26a69a', stDn: '#ef5350', macd: '#2962ff', macdSig: '#ff6d00', macdHistUp: '#26a69a', macdHistUp2: '#b2dfdb', macdHistDn: '#ef5350', macdHistDn2: '#ffcdd2', vwapD: '#ffeb3b', vwapW: '#ff9800', vwapSH: '#f48fb1', vwapSL: '#80cbc4', rsi: '#7e57c2', atr: '#ff7043',
  london: '#2962ff', ny: '#f9a825', sAsia: '#b39ddb', sLdn: '#5b7fff', sNy: '#ffb74d', fvgBull: '#26a69a', fvgBear: '#ef5350', alert: '#ff9800',
};
export const COLOR_NAMES = {
  up: 'Candle up', dn: 'Candle down', imp1: 'Impulse detector 1', imp2: 'Impulse detector 2', imp3: 'Impulse detector 3', ema12: 'EMA 12', ema21: 'EMA 21', ema50: 'EMA 50', ema200: 'EMA 200',
  tema15: 'TEMA 15', tema30: 'TEMA 30', stUp: 'Supertrend up', stDn: 'Supertrend down', vwapD: 'VWAP day', vwapW: 'VWAP week',
  vwapSH: 'AVWAP from swing high', vwapSL: 'AVWAP from swing low', rsi: 'RSI', atr: 'ATR', macd: 'MACD line', macdSig: 'MACD signal', macdHistUp: 'MACD hist up (growing)', macdHistUp2: 'MACD hist up (falling)',
  macdHistDn: 'MACD hist down (growing)', macdHistDn2: 'MACD hist down (falling)', london: 'London session', ny: 'New York session',
  sAsia: 'Asia high / low', sLdn: 'London high / low', sNy: 'New York high / low', fvgBull: 'Bullish FVG', fvgBear: 'Bearish FVG', alert: 'Alerts',
};
const hexA = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

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
  <div class="lc-scale">
    <button class="lc-sbtn" data-act="rt" title="Scroll to the latest candle (Home)">»</button>
    <button class="lc-sbtn" data-mode="pct" title="Percent scale">%</button>
    <button class="lc-sbtn" data-mode="log" title="Log scale">log</button>
    <button class="lc-sbtn" data-mode="auto" title="Auto scale">auto</button>
  </div>
  <div class="lc-ctx"></div>
  <button class="lc-axdel" title="Delete alert (Del)">✕</button>
</div>`;

// D: {coin, tf, prec, candles:[{time,open,high,low,close}], vol:[], layers:{}, impulseMult, panes:[{key, series:[{kind,name,color,data,cvd,scale}]}],
//     opens:[{title,price,time,color}], plan:[{title,price,color}], levels:[{title,price,color}], asia, profiles}
const THEMES = {
  dark: { bg: '#0f131c', text: '#c3c6ce', grid: '#171c27', border: '#232838', sep: '#232838', sepHover: '#33394a', label: 'rgba(15,19,28,0.85)', box: 'rgba(149,152,161,0.10)', boxLine: 'rgba(149,152,161,0.6)', boxText: '#b2b5be' },
  light: { bg: '#ffffff', text: '#2a2e39', grid: '#eef0f4', border: '#d6dae3', sep: '#d6dae3', sepHover: '#b8bfcc', label: 'rgba(255,255,255,0.9)', box: 'rgba(90,96,110,0.08)', boxLine: 'rgba(90,96,110,0.55)', boxText: '#4a5060' },
};

export function buildChart(host, D) {
  const TH = THEMES[D.theme] || THEMES.dark;
  const COL = Object.assign({}, DEFAULT_COLORS, D.theme === 'light' ? { ema50: '#5d6273' } : {}, D.colors || {});
  const UP = COL.up, DN = COL.dn;
  const OFF = D.tzOffset != null ? D.tzOffset : tzOffset('local');
  const sh = t => t + OFF;
  const intraday = (D.tfSec || 900) < 86400;
  const timeFmt = t => {        // crosshair label, like TradingView: "Sat 05 Sep '26  00:45"
    const d = new Date(t * 1000);
    const day = `${WD[d.getUTCDay()]} ${p2(d.getUTCDate())} ${MO[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
    return intraday ? `${day}   ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : day;
  };
  const tickFmt = (t, type) => {
    const d = new Date(t * 1000);
    if (type === 0) return String(d.getUTCFullYear());
    if (type === 1) return MO[d.getUTCMonth()];
    if (type === 2) return `${WD[d.getUTCDay()]} ${d.getUTCDate()}`;
    return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  };
  host.innerHTML = TEMPLATE;
  let dead = false;                         // set when this chart is replaced, so late timers do nothing
  const q = s => host.querySelector(s);
  const wrap = q('.lc-wrap'), el = q('.lc-c'), legend = q('.lc-legend');
  const C = D.candles, L = D.layers || {};
  const STEP = C.length > 1 ? C[C.length - 1].time - C[C.length - 2].time : 60;
  const fmt = p => (p == null || !Number.isFinite(p)) ? '—' : Number(p).toLocaleString('en-US', { minimumFractionDigits: D.prec, maximumFractionDigits: D.prec });

  const chart = LC.createChart(el, {
    autoSize: true,
    localization: { locale: 'en-US', timeFormatter: timeFmt },
    layout: { background: { type: 'solid', color: TH.bg }, textColor: TH.text, fontSize: 12,
      fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      panes: { separatorColor: TH.sep, separatorHoverColor: TH.sepHover, enableResize: true } },
    grid: { vertLines: { color: TH.grid }, horzLines: { color: TH.grid } },
    crosshair: { mode: LC.CrosshairMode.Normal },
    rightPriceScale: { borderColor: TH.border, minimumWidth: 72 },
    leftPriceScale: { borderColor: TH.border, visible: false },
    timeScale: { borderColor: TH.border, timeVisible: true, secondsVisible: false, rightOffset: 8, tickMarkFormatter: tickFmt },
  });
  // main series: candles, hollow candles, bars, line, area or Heikin Ashi (like TradingView's chart type menu)
  const TYPE = D.chartType || 'candles';
  const pf = { type: 'price', precision: D.prec, minMove: Math.pow(10, -D.prec) };
  const cs = TYPE === 'bars' ? chart.addSeries(LC.BarSeries, { upColor: UP, downColor: DN, thinBars: false, priceFormat: pf }, 0)
    : TYPE === 'line' ? chart.addSeries(LC.LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat: pf }, 0)
    : TYPE === 'area' ? chart.addSeries(LC.AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2, priceFormat: pf }, 0)
    : TYPE === 'hollow' ? chart.addSeries(LC.CandlestickSeries, { upColor: 'rgba(0,0,0,0)', downColor: DN, borderVisible: true, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN, priceFormat: pf }, 0)
    : chart.addSeries(LC.CandlestickSeries, { upColor: UP, downColor: DN, borderVisible: true, borderUpColor: UP, borderDownColor: DN, wickUpColor: UP, wickDownColor: DN, priceFormat: pf }, 0);

  // ── impulse (displacement) candles: body ≥ K × average body of the previous 20 and ≥ 60% of the range.
  // Double impulse: ≥ (K + 1) ×, triple impulse: ≥ (K + 2) ×. Each level has its own colour.
  // Triple impulsive candle detector (3 detectors, like the TradingView script): a candle passes a detector when
  //   body ≥ size × average body (length), volume ≥ volume multiplier × average volume (length), body ÷ range ≥ ratio.
  // Detector 3 wins over 2, and 2 over 1.
  const DET = D.impDet || [{ len: 10, size: 1.5, vol: 1.5, ratio: 0.7 }, { len: 14, size: 2, vol: 2, ratio: 0.6 }, { len: 20, size: 2.5, vol: 3, ratio: 0.5 }];
  const VOL = D.vol || [];
  function passes(i, d) {
    const n = Math.max(1, Math.round(d.len)); if (i < n - 1) return false;
    let sb = 0, sv = 0;
    for (let k = i - n + 1; k <= i; k++) { sb += Math.abs(C[k].close - C[k].open); sv += VOL[k] || 0; }
    const c = C[i], body = Math.abs(c.close - c.open), rng = c.high - c.low, ab = sb / n, av = sv / n;
    if (!(rng > 0 && ab > 0)) return false;
    const volOk = av > 0 ? (VOL[i] || 0) >= d.vol * av : true;          // markets without volume: size and ratio only
    return body >= d.size * ab && volOk && body / rng >= d.ratio;
  }
  function impulseTier(i) {
    if (!L.impulse) return 0;
    for (let t = 3; t >= 1; t--) if (DET[t - 1] && DET[t - 1].on !== false && passes(i, DET[t - 1])) return t;
    return 0;
  }
  const HA = [];                 // Heikin Ashi candles (display only; levels and drawings use real prices)
  function haAt(i) {
    const c = C[i], cl = (c.open + c.high + c.low + c.close) / 4;
    const op = i === 0 ? (c.open + c.close) / 2 : (HA[i - 1].open + HA[i - 1].close) / 2;
    HA[i] = { open: op, close: cl, high: Math.max(c.high, op, cl), low: Math.min(c.low, op, cl) };
    return HA[i];
  }
  function styled(i) {
    const c = C[i];
    if (TYPE === 'line' || TYPE === 'area') return { time: sh(c.time), value: c.close };
    const src = TYPE === 'heikin' ? haAt(i) : c;
    const o = { time: sh(c.time), open: src.open, high: src.high, low: src.low, close: src.close };
    const tier = TYPE !== 'heikin' ? impulseTier(i) : 0;
    // one colour per level for both directions: up = filled, down = hollow (outline only)
    if (tier) { const col = COL['imp' + tier], up = c.close >= c.open; o.color = TYPE === 'bars' || !D.impHollow ? col : up ? col : 'rgba(0,0,0,0)'; o.wickColor = col; o.borderColor = col; }
    return o;
  }
  cs.setData(C.map((_, i) => styled(i)));

  // ── EMAs
  const emas = [];
  [[12, 'ema12', COL.ema12], [21, 'ema21', COL.ema21], [50, 'ema50', COL.ema50]].forEach(([n, key, color]) => {
    if (!L[key] || !C.length) return;
    const k = 2 / (n + 1), vals = [];
    C.forEach((c, i) => vals.push(i === 0 ? c.close : c.close * k + vals[i - 1] * (1 - k)));
    const s = chart.addSeries(LC.LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, title: '' }, 0);
    s.setData(C.map((c, i) => ({ time: sh(c.time), value: vals[i] })).slice(Math.min(n, C.length - 1)));
    emas.push({ n, k, s, vals, color });
  });

  // ── price lines (key levels + trade plan)
  let lines = [];
  function drawLines() {
    lines.forEach(pl => cs.removePriceLine(pl)); lines = [];
    // axis labels only; the lines are drawn from where each level starts (see the layers below)
    // key levels and opens are labelled on the left only (where each line starts); the trade plan keeps its axis labels
    (D.plan || []).forEach(l => lines.push(cs.createPriceLine({ price: l.price, color: l.color,
      lineVisible: false, axisLabelVisible: true, title: l.title })));
    // price alerts: orange dashed line with a bell on the axis (trend-line alerts are drawn in the layers below)
    alertPL = (D.alerts || []).filter(a => a.kind !== 'line' && a.status === 'active').map(a => {
      const sel = selAlert && selAlert.id === a.id;
      const pl = cs.createPriceLine({ price: a.price, color: COL.alert, lineWidth: sel ? 2 : 1, lineStyle: sel ? LC.LineStyle.Solid : LC.LineStyle.Dashed, axisLabelVisible: true, title: '🔔' });
      lines.push(pl); return { a, pl };
    });
  }
  let alertPL = [], selAlert = null;
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
  // ── indicators (Supertrend, TEMA, EMA 200, VWAPs on the price pane; RSI and ATR in their own panes)
  const IND = makeIndicators(C, D.vol || [], D.ind || {}, COL);
  const indPane = {};
  let nextPane = (D.panes || []).length + 1;
  IND.forEach(ind => {
    let pi = 0;
    if (ind.pane !== 0) { if (indPane[ind.pane] == null) indPane[ind.pane] = nextPane++; pi = indPane[ind.pane]; }
    ind.pi = pi;
    const fmtI = ind.key === 'rsi' ? { type: 'price', precision: 1, minMove: 0.1 } : ind.key === 'macd' ? { type: 'custom', formatter: v => fmt(v), minMove: Math.pow(10, -D.prec - 2) } : pf;
    ind.series = ind.lines.map((l, k) => l.hist ? chart.addSeries(LC.HistogramSeries, { color: l.color, priceLineVisible: false, lastValueVisible: false, title: '', priceFormat: fmtI }, pi) : chart.addSeries(LC.LineSeries, { color: l.color, lineWidth: l.width, lineStyle: l.dash ? LC.LineStyle.Dashed : LC.LineStyle.Solid,
      priceLineVisible: false, lastValueVisible: pi !== 0 || ind.key === 'st', crosshairMarkerVisible: false, title: pi !== 0 && k === 0 ? ind.name : '', priceFormat: fmtI }, pi));
    if (ind.levels) ind.levels.forEach(v => ind.series[0].createPriceLine({ price: v, color: v === 50 ? 'rgba(149,152,161,0.35)' : 'rgba(149,152,161,0.6)', lineStyle: LC.LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false }));
    ind.calc(0); setInd(ind);
  });
  function indPoint(ind, k, i) {
    const l = ind.lines[k], v = l.vals[i];
    if (!(i >= ind.min && v != null && Number.isFinite(v))) return { time: sh(C[i].time) };
    return l.colorAt ? { time: sh(C[i].time), value: v, color: l.colorAt(i) } : { time: sh(C[i].time), value: v };
  }
  function setInd(ind) { ind.series.forEach((se, k) => se.setData(C.map((_, i) => indPoint(ind, k, i)))); }
  function updInd(i, isNew) {
    IND.forEach(ind => {
      if (ind.full) { ind.calc(0); if (isNew) setInd(ind); else ind.series.forEach((se, k) => { try { se.update(indPoint(ind, k, i)); } catch (e) { /* ignore */ } }); return; }
      ind.calc(i);
      ind.series.forEach((se, k) => { try { se.update(indPoint(ind, k, i)); } catch (e) { /* ignore */ } });
    });
  }
  // RSI divergence arrows on the candles
  const rsiInd = IND.find(x => x.key === 'rsi');
  const markers = LC.createSeriesMarkers ? LC.createSeriesMarkers(cs, []) : null;
  function setDivs() {
    if (!markers) return;
    const ms = (rsiInd ? rsiInd.divergences().map(d => Object.assign(d, { text: d.bull ? 'Bull div' : 'Bear div' })) : [])
      .concat(...IND.filter(x => x.markers).map(x => x.markers()));
    markers.setMarkers(ms.sort((a, b) => a.i - b.i).map(d => ({ time: sh(C[d.i].time), position: d.bull ? 'belowBar' : 'aboveBar', color: d.bull ? COL.up : COL.dn,
      shape: d.bull ? 'arrowUp' : 'arrowDown', text: d.text, size: 1 })));
  }
  setDivs();
  let FVG = L.fvg ? fairValueGaps(C) : [], SL = L.sesshl && STEP <= 3600 ? sessionLevels(C) : [];
  const recalcZones = () => { FVG = L.fvg ? fairValueGaps(C) : []; SL = L.sesshl && STEP <= 3600 ? sessionLevels(C) : []; };

  // log / % scale applies to the price pane only; lower panes (volume, OI, CVD…) stay normal
  function applyScaleModes() {
    const mode = D.scaleMode === 'log' ? LC.PriceScaleMode.Logarithmic : D.scaleMode === 'pct' ? LC.PriceScaleMode.Percentage : LC.PriceScaleMode.Normal;
    chart.panes().forEach((p, i) => p.getSeries().forEach(x => x.priceScale().applyOptions({ mode: i === 0 ? mode : LC.PriceScaleMode.Normal })));
  }
  applyScaleModes();
  const ps = chart.panes();
  if (ps.length > 1) { ps[0].setStretchFactor(ps.length > 3 ? 3 : 2.4); for (let i = 1; i < ps.length; i++) ps[i].setStretchFactor(1); }

  // CVD lines start at 0 on the first visible candle (like Coinalyze)
  // CVD counts from the first loaded candle (like Coinalyze), so zooming and scrolling never change the values
  function cvdData(raw) {
    if (!raw || !raw.length) return [];
    let acc = 0;
    return raw.map(p => { acc += p.value; return { time: sh(p.time), value: acc }; });
  }
  function setSeries(rec, data) {
    rec.raw = data || [];
    if (rec.def.cvd) rec.api.setData(cvdData(rec.raw));
    else rec.api.setData(rec.raw.map(p => Object.assign({}, p, { time: sh(p.time) })));
  }
  const cvdTimer = null;

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
    // right-side labels share one list so close levels stack instead of overlapping
    const used = [];
    const rlabel = (s2, xr, y, color) => {
      let ty = y;
      for (let k = 0; k < 12 && used.some(u => Math.abs(u.y - ty) < 12 && Math.abs(u.x - xr) < 160); k++) ty -= 12;
      used.push({ x: xr, y: ty }); text(ctx, s2, xr, ty, color, 'right');
    };
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
          ctx.fillStyle = hexA(s === 'L' ? COL.london : COL.ny, 0.07);
          ctx.fillRect(a - bs, 0, b - a + 2 * bs, H);
          if (b - a + 2 * bs > 58) text(ctx, s === 'L' ? 'London' : 'New York', a - bs + 3, H - 6, s === 'L' ? COL.london : COL.ny);
        }
        i = j + 1;
      }
    }
    // previous 4H volume profile (for scalping on 1m – 1h): histogram over that 4H block, POC / VAH / VAL run to the right
    if (L.vp4h && STEP <= 3600 && n > 5 && D.vol) {
      const p = vp4h();
      if (p) {
        const x1 = X(p.start), x2 = X(p.end);
        if (x1 != null && x2 != null && x2 > 0 && x1 < W) {
          const width = Math.max(30, (x2 - x1) * 0.9), mx = Math.max(...p.tot) || 1;
          for (let i = 0; i < p.tot.length; i++) {
            const yt = Y(p.lo + p.step * (i + 1)), yb = Y(p.lo + p.step * i); if (yt == null || yb == null) continue;
            const inVA = i >= p.d && i <= p.u, h = Math.max(1, Math.abs(yb - yt) - 1), wu = width * p.up[i] / mx, wd = width * p.dn[i] / mx;
            ctx.fillStyle = hexA(COL.up, inVA ? 0.30 : 0.12); ctx.fillRect(x1, yt, wu, h);
            ctx.fillStyle = hexA(COL.dn, inVA ? 0.30 : 0.12); ctx.fillRect(x1 + wu, yt, wd, h);
          }
          [[p.poc, '4HPOC', '#ffb300', []], [p.vah, '4HVAH', '#90a4ae', [4, 3]], [p.val, '4HVAL', '#90a4ae', [4, 3]]].forEach(([v, t, c, d]) => {
            const y = Y(v); if (y == null) return;
            hline(ctx, Math.max(0, x1), W, y, c, d, t === '4HPOC' ? 1.4 : 1); rlabel(`${t} ${fmt(v)}`, W - 6, y - 3, c);
          });
        }
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
        rlabel(`AH ${fmt(a.hi)}`, W - 6, yh - 3, TH.boxText); rlabel(`AL ${fmt(a.lo)}`, W - 6, yl - 3, TH.boxText);
      }
    }
    // fair value gaps: open ones run to the right edge, filled ones stop where price filled them
    FVG.forEach(g => {
      const x1 = X(g.t), x2 = g.end != null ? X(g.end) : W, yt = Y(g.top), yb = Y(g.bot);
      if (x1 == null || x2 == null || yt == null || yb == null || x2 < 0 || x1 > W) return;
      const col = g.bull ? COL.fvgBull : COL.fvgBear, open = g.end == null;
      ctx.fillStyle = hexA(col, open ? 0.16 : 0.06); ctx.fillRect(x1, yt, Math.min(x2, W) - x1, yb - yt);
      if (open && Math.abs(yb - yt) > 9) text(ctx, 'FVG', x1 + 3, Math.min(yt, yb) + 10, hexA(col, 0.9));
    });
    // session highs / lows (sweep targets): solid until swept, then it stops at the sweep candle
    SL.forEach(s => {
      const col = s.name === 'Asia' ? COL.sAsia : s.name === 'LDN' ? COL.sLdn : COL.sNy;
      [['hi', s.hi, s.hiEnd, 'H'], ['lo', s.lo, s.loEnd, 'L']].forEach(([, p, end, tag]) => {
        const y = Y(p), x1 = X(s.t1); if (y == null || x1 == null) return;
        const x2 = end != null ? X(end) : W; if (x2 == null || x2 < 0 || x1 > W) return;
        ctx.globalAlpha = end != null ? 0.45 : 0.95;
        hline(ctx, x1, Math.min(x2, W), y, col, end != null ? [2, 2] : [], 1);
        rlabel(`${s.name} ${tag}${end != null ? ' ✓' : ''}`, Math.min(x2, W) - 4, y - 3, col);
        ctx.globalAlpha = 1;
      });
    });
    // economic news (CPI, PPI, FOMC, NFP…): dashed vertical line + label at the event time
    if (L.news && D.news && D.news.length && STEP <= 14400) {
      D.news.forEach((ev, k) => {
        const x = X(ev.t); if (x == null || x < 0 || x > W) return;
        const col = ev.impact === 'High' ? '#ef5350' : '#f9a825';
        ctx.beginPath(); ctx.setLineDash([3, 4]); ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
        ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.font = '600 10.5px Inter, sans-serif';
        const lbl = ev.short, w = ctx.measureText(lbl).width + 8, y = (legend.offsetHeight || 36) + 22 + (k % 3) * 16;
        ctx.fillStyle = col; ctx.fillRect(x - w / 2, y - 11, w, 15);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(lbl, x, y); ctx.textAlign = 'left';
      });
    }
    // trend-line price alerts
    (D.alerts || []).filter(a => a.kind === 'line' && a.status === 'active' && a.line).forEach(a => {
      const p1 = { x: X(a.line.t1), y: Y(a.line.p1) }, p2 = { x: X(a.line.t2), y: Y(a.line.p2) };
      if (p1.x == null || p1.y == null || p2.x == null || p2.y == null || p2.x === p1.x) return;
      const k = (p2.y - p1.y) / (p2.x - p1.x), yE = p1.y + k * (W - p1.x);
      const sel = selAlert && selAlert.id === a.id;
      ctx.beginPath(); ctx.setLineDash(sel ? [] : [5, 4]); ctx.strokeStyle = COL.alert; ctx.lineWidth = sel ? 2 : 1.2; ctx.moveTo(p1.x, p1.y); ctx.lineTo(W, yE); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, '🔔', W - 18, yE - 4, COL.alert);
    });
    // opens + key levels + trade plan: each line starts where the level was made and runs to the right edge.
    // Levels at the same price share one line and one label.
    const groups = new Map();
    const add = (price, time, title, color, kind, end) => {
      const k = price.toFixed(D.prec) + '|' + (end || ''), g = groups.get(k);
      if (g) { g.titles.push(title); g.time = Math.min(g.time, time); if (kind === 'plan') g.kind = 'plan'; }
      else groups.set(k, { price, time, titles: [title], color, kind, end });
    };
    (D.opens || []).forEach(o => add(o.price, o.time, o.title, o.color, 'open', o.end));
    (D.levels || []).forEach(l => add(l.price, l.time != null ? l.time : C[0].time, l.title, l.color, 'level', l.end));
    const tPlan = C.length ? C[Math.max(0, C.length - 8)].time : 0;
    (D.plan || []).forEach(p => add(p.price, tPlan, p.title, p.color, 'plan'));
    groups.forEach(g => {
      const y = Y(g.price); if (y == null) return;
      let x = X(g.time); if (x == null) return; x = Math.max(0, x);
      if (x > W) return;
      const plan = g.kind === 'plan';
      let xe = W; if (g.end) { const e2 = X(g.end); if (e2 == null || e2 < 0) return; xe = Math.min(W, e2); }
      if (g.end) ctx.globalAlpha = 0.7;
      hline(ctx, x, xe, y, g.color, plan ? (g.titles[0] === 'Entry' ? [] : [8, 4]) : g.kind === 'open' ? [6, 3] : [2, 3], plan ? 2 : 1.2);
      ctx.beginPath(); ctx.fillStyle = g.color; ctx.arc(x, y, 2.5, 0, 7); ctx.fill();
      // label at the right end of the line (like TradingView), stacked when levels are close together
      rlabel(g.titles.join(' · ') + (g.kind === 'plan' ? '' : ' ' + fmt(g.price)), xe - 6, y - 3, g.color);
      ctx.globalAlpha = 1;
    });
  });

  // previous completed 4H block (UTC 00/04/08/12/16/20), rows split by candle range, 70% value area
  let vp4hCache = null;
  function vp4h() {
    const last = C[C.length - 1].time, start = Math.floor(last / 14400) * 14400 - 14400, end = start + 14400;
    if (vp4hCache && vp4hCache.start === start && vp4hCache.n === C.length) return vp4hCache.p;
    let lo = Infinity, hi = -Infinity; const idx = [];
    for (let i = C.length - 1; i >= 0 && C[i].time >= start; i--) if (C[i].time < end) { idx.push(i); lo = Math.min(lo, C[i].low); hi = Math.max(hi, C[i].high); }
    let p = null;
    if (idx.length >= 2 && hi > lo) {
      const R0 = 30, step = (hi - lo) / R0, up = new Array(R0).fill(0), dn = new Array(R0).fill(0);
      idx.forEach(i => { const c = C[i], v = D.vol[i] || 0, r0 = Math.max(0, Math.min(R0 - 1, Math.floor((c.low - lo) / step))), r1 = Math.max(0, Math.min(R0 - 1, Math.floor((c.high - lo) / step)));
        const sv = v / (r1 - r0 + 1), arr = c.close >= c.open ? up : dn; for (let k = r0; k <= r1; k++) arr[k] += sv; });
      const tot = up.map((x, i) => x + dn[i]), total = tot.reduce((a, b) => a + b, 0);
      if (total > 0) {
        let poc = 0; tot.forEach((x, i) => { if (x > tot[poc]) poc = i; });
        let u = poc, d = poc, acc = tot[poc];
        while (acc < total * 0.7 && (u < R0 - 1 || d > 0)) { const vu = u < R0 - 1 ? tot[u + 1] : -1, vd = d > 0 ? tot[d - 1] : -1; if (vu >= vd) { u++; acc += vu; } else { d--; acc += vd; } }
        p = { start, end, lo, step, up, dn, tot, u, d, poc: lo + step * (poc + 0.5), vah: lo + step * (u + 1), val: lo + step * d };
      }
    }
    vp4hCache = { start, n: C.length, p };
    return p;
  }

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
  const drawing = attachDrawing({ chart, cs, el, root: host, C, X, Y, timeToLogical, logicalToTime, fmt, coin: D.coin, primitive, LC, paneW, STEP,
    onAlert: a => D.onAddAlert && D.onAddAlert(a), onSave: D.onDrawingsSaved, initial: D.drawings, theme: D.theme });

  // ── legend (OHLC of the candle under the mouse)
  function showLegend(i) {
    if (!C.length) return;
    i = i == null || i < 0 || i >= C.length ? C.length - 1 : i;
    const c = C[i], prev = i > 0 ? C[i - 1].close : c.open, ch = (c.close / prev - 1) * 100, col = c.close >= c.open ? UP : DN;
    const v = D.vol && D.vol[i], compact = el.clientHeight < 520;
    legend.innerHTML = `<b>${D.coin}</b> · ${D.tf} · ${D.source || ''}<br>` +
      `<span>O <i style="color:${col}">${fmt(c.open)}</i></span> <span>H <i style="color:${col}">${fmt(c.high)}</i></span> ` +
      `<span>L <i style="color:${col}">${fmt(c.low)}</i></span> <span>C <i style="color:${col}">${fmt(c.close)}</i></span> ` +
      `<span style="color:${ch >= 0 ? UP : DN}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>` + (v ? ` <span>Vol <i>${abbr(v)}</i></span>` : '') +
      (compact ? '' : emas.length || IND.some(x => x.legend) ? '<br>' + emas.map(m => `<span>EMA ${m.n} <i style="color:${m.color}">${fmt(m.vals[i])}</i></span>`).join(' ') +
        IND.filter(x => x.legend).map(x => { const v = x.value ? x.value(i) : x.lines[0].vals[i]; const c = x.valueColor ? x.valueColor(i) : x.lines[0].color;
          return i >= x.min && Number.isFinite(v) ? ` <span>${x.name} <i style="color:${c}">${fmt(v)}</i></span>` : ''; }).join('') : '') +
      (!compact && IND.some(x => x.pi) ? '<br>' + IND.filter(x => x.pi).map(x => { const ln = x.key === 'macd' ? x.lines[1] : x.lines[0], v = ln.vals[i]; return Number.isFinite(v) ? `<span>${x.name} <i style="color:${ln.color}">${x.key === 'rsi' ? v.toFixed(1) : fmt(v)}</i></span>` : ''; }).join(' ') : '');
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
    if (selAlert && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); e.stopPropagation(); const a = selAlert; selAlert = null; hideDel(); if (D.onDeleteAlert) D.onDeleteAlert(a.id); return; }
    if (selAlert && e.key === 'Escape') { selAlert = null; hideDel(); drawLines(); redrawLayers(); return; }
    if (drawing.onKey(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const k = e.key;
    if ((e.altKey || e.ctrlKey || e.metaKey) && e.code === 'KeyR') { e.preventDefault(); e.stopPropagation(); reset(); }      // Alt+R / Ctrl+R reset chart
    else if (e.altKey && e.code === 'KeyA') { e.preventDefault(); const p = lastMouse ? priceAtY(lastMouse.y) : null; if (p != null && D.onAddAlert) D.onAddAlert({ kind: 'price', price: p }); }
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
  // In log and % mode the library reads and sets the visible range in different units, so a manual range would blank the chart.
  const odd = () => D.scaleMode === 'log' || D.scaleMode === 'pct';
  function paneAt(y) { let top = 0; for (const p of chart.panes()) { const h = p.getHeight(); if (y >= top && y < top + h) return { p, h }; top += h + 1; } return null; }
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drawing.busy() || e.shiftKey) return;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x > r.width - cs.priceScale().width() || y > r.height - ts.height()) return;
    const hit = paneAt(y); if (!hit) return;
    if (hit.p !== chart.panes()[0]) return;   // lower panes (OI, CVD, volume, RSI…) always auto-fit, like TradingView
    const ser = hit.p.getSeries()[0]; if (!ser) return;
    if (ser === cs && odd()) return;          // log / % scale: the library's own axis drag is used instead
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
    if (hit.p !== chart.panes()[0]) return;
    const ser = hit.p.getSeries()[0]; if (!ser) return;
    if (ser === cs && odd()) return;
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

  // ── countdown to the candle close, under the last price (like TradingView)
  const tfSec = D.tfSec || STEP;
  const candleEnd = t => { if (D.tf === '1M') { const d = new Date(t * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000; } return t + tfSec; };
  const fdur = s => { s = Math.max(0, Math.floor(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return d ? `${d}d ${h}h` : h ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`; };
  const cdInfo = () => {
    if (!C.length) return null;
    const t0 = C[C.length - 1].time, end = candleEnd(t0), now = Date.now() / 1000, left = end - now;
    if (left < 0 || left > (end - t0) * 1.5) return null;
    return { left, passed: now - t0, pct: Math.min(100, Math.max(0, (now - t0) / (end - t0) * 100)) };
  };
  const cdText = () => { const i = cdInfo(); return i ? fdur(i.left) : ''; };
  // the countdown sits on the price axis right under the price label, like TradingView
  const cdPrim = {
    attached(a) { this.req = a.requestUpdate; }, detached() {}, updateAllViews() {},
    priceAxisViews() {
      const t = cdText(); if (!t || !C.length) return [];
      const y = Y(C[C.length - 1].close); if (y == null) return [];
      const up = C[C.length - 1].close >= C[C.length - 1].open;
      return [{ coordinate: () => y + 17, text: () => t, textColor: () => '#ffffff', backColor: () => up ? UP : DN, visible: () => true, tickVisible: () => false }];
    },
  };
  cs.attachPrimitive(cdPrim);
  const redrawCd = () => cdPrim.req && cdPrim.req();
  const cdTimer = setInterval(() => { if (!dead) redrawCd(); }, 1000);
  // hover the countdown: time left and time passed
  const cdTip = document.createElement('div'); cdTip.className = 'lc-cdtip'; wrap.appendChild(cdTip);
  el.addEventListener('mousemove', e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, i = cdInfo();
    const yl = C.length ? Y(C[C.length - 1].close) : null;
    if (!i || yl == null || x < ts.width() || Math.abs(y - (yl + 17)) > 10) { cdTip.style.display = 'none'; return; }
    cdTip.innerHTML = `<b>${fdur(i.left)}</b> left · ${fdur(i.passed)} passed<div class="bar"><i style="width:${i.pct.toFixed(1)}%"></i></div>${i.pct.toFixed(0)}% of this ${esc2(D.tf)} candle`;
    cdTip.style.display = 'block'; cdTip.style.top = (yl + 30) + 'px'; cdTip.style.right = '8px';
  });
  el.addEventListener('mouseleave', () => { cdTip.style.display = 'none'; });

  // ── price scale buttons: %, log, auto · and "»" back to the latest candle
  const scaleBox = q('.lc-scale');
  function setMode(m) {
    D.scaleMode = m;
    applyScaleModes(); cs.priceScale().applyOptions({ autoScale: true });
    scaleBox.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    if (D.onScaleMode) D.onScaleMode(m);
  }
  scaleBox.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    const m = b.dataset.mode;
    if (m === 'auto') { chart.panes().forEach(p => p.getSeries().forEach(x => x.priceScale().applyOptions({ autoScale: true }))); return; }
    setMode(D.scaleMode === m ? 'normal' : m);
  });
  scaleBox.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === D.scaleMode));
  const rtBtn = scaleBox.querySelector('[data-act=rt]');
  rtBtn.onclick = () => ts.scrollToRealTime();
  ts.subscribeVisibleLogicalRangeChange(r => { if (r) rtBtn.style.visibility = r.to < C.length - 3 ? 'visible' : 'hidden'; });

  // ── right-click menu (add alert, horizontal line, reset) — and Alt+A adds an alert at the mouse price
  const ctxMenu = q('.lc-ctx');
  let lastMouse = null;
  el.addEventListener('mousemove', e => { const r = el.getBoundingClientRect(); lastMouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
  const priceAtY = y => { const p = cs.coordinateToPrice(y); return p == null ? null : +p.toFixed(D.prec); };
  el.addEventListener('contextmenu', e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (y > chart.panes()[0].getHeight()) return;
    e.preventDefault();
    const p = priceAtY(y); if (p == null) return;
    const near = alertAt(x, y);
    const items = (near ? [['aedit', `✎ Edit alert ${fmt(alertLevel(near))}`], ['adel', '🗑 Delete alert']] : []).concat([['alert', `🔔 Add alert at ${fmt(p)}`], ['hline', `─ Horizontal line at ${fmt(p)}`], ['reset', '⟲ Reset chart (Alt+R)'], ['copy', `Copy price ${fmt(p)}`]]);
    ctxMenu.innerHTML = items.map(([k, t]) => `<div data-k="${k}">${t}</div>`).join('');
    const wr = wrap.getBoundingClientRect();
    ctxMenu.style.left = Math.min(e.clientX - wr.left, wr.width - 240) + 'px'; ctxMenu.style.top = (e.clientY - wr.top) + 'px'; ctxMenu.style.display = 'block';
    ctxMenu.querySelectorAll('[data-k]').forEach(d => d.onclick = () => {
      ctxMenu.style.display = 'none';
      if (d.dataset.k === 'alert' && D.onAddAlert) D.onAddAlert({ kind: 'price', price: p });
      if (d.dataset.k === 'aedit' && D.onEditAlert) D.onEditAlert(near.id);
      if (d.dataset.k === 'adel' && D.onDeleteAlert) { selAlert = null; hideDel(); D.onDeleteAlert(near.id); }
      if (d.dataset.k === 'hline') drawing.addHorizontal(p);
      if (d.dataset.k === 'reset') reset();
      if (d.dataset.k === 'copy') { try { navigator.clipboard.writeText(String(p)); } catch (err) { /* ignore */ } }
    });
  });
  const hideCtx = () => { ctxMenu.style.display = 'none'; };
  window.addEventListener('pointerdown', ev => { if (!ctxMenu.contains(ev.target)) hideCtx(); }, true);

  // ── price alerts on the chart: drag the line to move it, click to select (Del deletes), ✕ to delete
  const delBtn = q('.lc-axdel');
  const alertLevel = a => a.kind === 'line' ? lineAlertY(a, null) : a.price;
  function lineAlertY(a, x) {         // price of a trend-line alert at pixel x (or at the last candle)
    const { t1, p1, t2, p2 } = a.line, l1 = timeToLogical(t1), l2 = timeToLogical(t2);
    const l = x == null ? C.length - 1 : ts.coordinateToLogical(x);
    if (l == null || l2 === l1) return p1;
    return p1 + (p2 - p1) * (l - l1) / (l2 - l1);
  }
  function alertAt(x, y) {
    if (!D.alerts || y > chart.panes()[0].getHeight()) return null;
    let best = null, bd = 6;
    D.alerts.filter(a => a.status === 'active').forEach(a => {
      let ya;
      if (a.kind === 'line') { if (!a.line) return; const xx = Math.min(x, ts.width()); ya = Y(lineAlertY(a, xx)); if (x < X(a.line.t1) - 4) return; }
      else ya = Y(a.price);
      if (ya == null) return;
      const d = Math.abs(ya - y); if (d < bd) { bd = d; best = a; }
    });
    return best;
  }
  function showDel(a) {
    const W = ts.width(), y = a.kind === 'line' ? Y(lineAlertY(a, W - 30)) : Y(a.price);
    if (y == null) { hideDel(); return; }
    delBtn.dataset.id = a.id; delBtn.style.display = 'block';
    delBtn.style.left = (el.offsetLeft + W - 100) + 'px'; delBtn.style.top = (y - 10) + 'px';
  }
  function hideDel() { delBtn.style.display = 'none'; }
  delBtn.onpointerdown = e => { e.stopPropagation(); };
  delBtn.onclick = e => { e.stopPropagation(); const id = delBtn.dataset.id; selAlert = null; hideDel(); if (D.onDeleteAlert) D.onDeleteAlert(id); };
  let aDrag = null;
  wrap.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !el.contains(e.target) || drawing.busy()) return;
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const a = alertAt(Math.min(x, ts.width() - 1), y);
    if (!a) { if (selAlert) { selAlert = null; hideDel(); drawLines(); redrawLayers(); } return; }
    e.stopPropagation(); e.preventDefault();
    chart.applyOptions({ handleScroll: false, handleScale: false });
    const rec = alertPL.find(z => z.a.id === a.id);
    aDrag = { a, rec, y0: y, p0: cs.coordinateToPrice(y), moved: false, orig: a.kind === 'line' ? Object.assign({}, a.line) : a.price };
  }, true);
  const onAMove = e => {
    const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!aDrag) {
      if (e.buttons || drawing.busy() || x < 0 || y < 0 || x > r.width || y > r.height) return;
      const a = alertAt(Math.min(x, ts.width() - 1), y);
      if (a) { el.style.cursor = 'ns-resize'; showDel(a); }
      else if (selAlert) showDel(selAlert); else hideDel();
      return;
    }
    e.stopPropagation();
    if (!aDrag.moved && Math.abs(y - aDrag.y0) < 3) return;
    aDrag.moved = true;
    const p = cs.coordinateToPrice(y); if (p == null || aDrag.p0 == null) return;
    if (aDrag.a.kind === 'line') {
      const dp = p - aDrag.p0; aDrag.a.line = Object.assign({}, aDrag.orig, { p1: aDrag.orig.p1 + dp, p2: aDrag.orig.p2 + dp }); redrawLayers();
    } else { aDrag.a.price = +p.toFixed(D.prec); if (aDrag.rec) aDrag.rec.pl.applyOptions({ price: aDrag.a.price }); }
    showDel(aDrag.a);
  };
  const onAUp = () => {
    if (!aDrag) return;
    chart.applyOptions({ handleScroll: true, handleScale: true });
    const d = aDrag; aDrag = null;
    if (d.moved) { if (D.onMoveAlert) D.onMoveAlert(d.a.id, d.a.kind === 'line' ? { line: d.a.line } : { price: d.a.price }); }
    else { selAlert = d.a; drawLines(); redrawLayers(); showDel(d.a); }
  };
  window.addEventListener('pointermove', onAMove, true);
  window.addEventListener('pointerup', onAUp, true);
  wrap.addEventListener('mouseleave', () => { if (!selAlert && !aDrag) hideDel(); });

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
      updInd(i, isNew);
      if (isNew) { setDivs(); recalcZones(); redrawLayers(); }
      showLegend();
      redrawVP();
    },
    setPane(key, idx, data) { if (dead) return; const p = paneSeries[key]; if (p && p[idx]) setSeries(p[idx], data); },
    hasPane: key => !!paneSeries[key],
    setOverlays(o) { if (dead) return; Object.assign(D, o); drawLines(); redrawLayers(); },
    lastTime: () => (C.length ? C[C.length - 1].time : 0),
    fullscreen,
    setAlerts(a) { if (dead) return; D.alerts = a; if (selAlert && !a.some(x => x.id === selAlert.id && x.status === 'active')) { selAlert = null; hideDel(); } drawLines(); redrawLayers(); },
    destroy() {
      dead = true; clearTimeout(cvdTimer); clearInterval(cdTimer); drawing.destroy();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointermove', onAMove, true);
      window.removeEventListener('pointerup', onAUp, true);
      try { chart.remove(); } catch (e) { /* ignore */ }
      host.innerHTML = '';
    },
  };
  return api;
}
