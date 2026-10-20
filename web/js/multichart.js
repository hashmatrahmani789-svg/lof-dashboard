// Extra charts for the 2- and 4-chart layouts (like TradingView's multi-chart layouts).
// Each one has its own market and timeframe, live price, your layers, indicators, drawings and alerts.
import * as API from './data.js';
import { analyze } from './engine.js';
import { buildChart, tzOffset } from './chart.js';
import { esc } from './ui.js';

export function createMini(cell, init, ctx) {
  // ctx: { byBase(), allKeys(), tfs, tfLabel, chartOpts(), overlays(r, bars), alertsFor(key), alertHooks(key, sym, tradfi, prec),
  //        onDrawingsSaved(coin, shapes), feed(key, price), onOpenMain(key), onChange(state), params() }
  const st = { coin: init.coin, tf: init.tf };
  let gen = 0, chart = null, ws = null, timers = [], bars = [], meta = null, r = null, aBars = {}, noMore = false, loadingOld = false;
  cell.innerHTML = `<div class="mini-h">
      <input class="mini-sym" value="${esc(st.coin)}" list="miniSyms" spellcheck="false" title="Market (type and press Enter)">
      <select class="mini-tf" title="Timeframe">${ctx.tfs.map(t => `<option value="${t}" ${t === st.tf ? 'selected' : ''}>${ctx.tfLabel(t)}</option>`).join('')}</select>
      <span class="mini-px num"></span><span class="sp"></span>
      <button class="icon-btn mini-main" title="Open as the main chart (full analysis)">⤢</button></div>
    <div class="mini-host"><div class="loading">Loading…</div></div>`;
  const host = cell.querySelector('.mini-host'), inp = cell.querySelector('.mini-sym'), sel = cell.querySelector('.mini-tf'), pxEl = cell.querySelector('.mini-px');
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { setCoin(inp.value.trim().toUpperCase()); inp.blur(); } };
  inp.onchange = () => setCoin(inp.value.trim().toUpperCase());
  sel.onchange = () => { st.tf = sel.value; ctx.onChange(st); load(); };
  cell.querySelector('.mini-main').onclick = () => ctx.onOpenMain(st.coin);

  function resolve(k) {
    if (API.TRADFI[k]) { const d = API.TRADFI[k]; return { tradfi: true, sym: d.t, prec: ['US2Y', 'US10Y', 'US30Y'].includes(k) ? 3 : k === 'ETHBTC' ? 5 : 2, src: 'Yahoo · ' + d.t }; }
    const m = ctx.byBase()[k]; if (!m) return null;
    return { tradfi: false, sym: m.sym, prec: m.prec, src: 'Binance · ' + m.sym };
  }
  function setCoin(k) {
    if (!k || k === st.coin) { inp.value = st.coin; return; }
    if (!resolve(k)) { inp.value = st.coin; inp.classList.add('bad'); setTimeout(() => inp.classList.remove('bad'), 1200); return; }
    st.coin = k; inp.value = k; ctx.onChange(st); load();
  }
  const stop = () => { timers.forEach(clearInterval); timers = []; if (ws) { ws.close(); ws = null; } };

  function build() {
    if (chart) { chart.destroy(); chart = null; }
    if (!bars.length) { host.innerHTML = '<div class="loading">No data</div>'; return; }
    const o = ctx.chartOpts(), withVol = o.panes.includes('vol');
    const panes = withVol ? [{ key: 'vol', series: [{ kind: 'hist', name: meta.tradfi ? 'Volume' : 'Volume (USD)', color: '#787b86', data: [] }].concat(o.lines.includes('Volume MA') ? [{ kind: 'line', name: 'Vol MA 20', color: '#f9a825', data: [] }] : []) }] : [];
    chart = buildChart(host, Object.assign({
      coin: st.coin, tf: st.tf, tfSec: API.TF_SEC[st.tf], prec: meta.prec, theme: o.theme, source: meta.src,
      tzOffset: tzOffset(o.tz), chartType: o.chartType, scaleMode: 'normal', colors: o.colors, ind: o.ind,
      candles: bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })), vol: bars.map(b => b.v || 0),
      impulseMult: o.impulseMult, layers: o.layers, panes,
      alerts: ctx.alertsFor(st.coin),
      onDrawingsSaved: shapes => ctx.onDrawingsSaved(st.coin, shapes),
      onNeedHistory: older,
    }, ctx.alertHooks(st.coin, meta.sym, meta.tradfi, meta.prec), ctx.overlays(r, aBars)));
    if (withVol) {
      const v = bars.map(b => ({ time: b.t, value: b.v || 0, color: b.c >= b.o ? 'rgba(38,166,154,0.55)' : 'rgba(239,83,80,0.55)' }));
      chart.setPane('vol', 0, v);
      const ma = []; for (let i = 19; i < v.length; i++) { let s = 0; for (let j = i - 19; j <= i; j++) s += v[j].value; ma.push({ time: v[i].time, value: s / 20 }); }
      chart.setPane('vol', 1, ma);
    }
  }
  function apply(bar) {
    const last = bars[bars.length - 1];
    if (last && bar.t < last.t) return;
    if (last && bar.t === last.t) bars[bars.length - 1] = bar; else bars.push(bar);
    if (chart) chart.update(bar);
    pxEl.textContent = bar.c.toLocaleString('en-US', { minimumFractionDigits: meta.prec, maximumFractionDigits: meta.prec });
    ctx.feed(st.coin, bar.c);
  }
  async function older() {
    if (meta.tradfi || noMore || loadingOld || !bars.length || bars.length > 30000) return;
    loadingOld = true; const g = gen;
    try {
      const first = bars[0].t, o = (await API.klines(meta.sym, st.tf, 1500, first * 1000 - 1)).filter(b => b.t < first);
      if (g !== gen) return;
      if (o.length < 1400) noMore = true;
      if (o.length) { bars = o.concat(bars); build(); }
    } catch (e) { /* retry on next scroll */ } finally { setTimeout(() => { loadingOld = false; }, 400); }
  }
  // levels, opens, Asia range and profiles from the LOF engine (price only, no order flow)
  async function analysis(g) {
    try {
      let l, d, h4, m30;
      if (meta.tradfi) [l, m30, h4, d] = await Promise.all([API.yahooBars(meta.sym, '15m'), API.yahooRaw(meta.sym, '30m', '1mo').then(x => x.bars), API.yahooBars(meta.sym, '4h'), API.yahooRaw(meta.sym, '1d', '2y').then(x => x.bars)]);
      else [l, d, h4, m30] = await Promise.all([API.klines(meta.sym, '15m', 400), API.klines(meta.sym, '1D', 400), API.klines(meta.sym, '4h', 200), API.klines(meta.sym, '30m', 720)]);
      if (g !== gen) return;
      aBars = { ltf: l, daily: d, h4, m30 };
      r = analyze({ ltf: l, daily: d, h4, m30, flow: null, tradfi: meta.tradfi, params: ctx.params() });
      if (chart) chart.setOverlays(ctx.overlays(r, aBars));
    } catch (e) { /* levels are optional */ }
  }
  async function load() {
    const g = ++gen; stop(); noMore = false; r = null; aBars = {};
    meta = resolve(st.coin);
    if (!meta) { host.innerHTML = '<div class="loading">Unknown market</div>'; return; }
    host.innerHTML = '<div class="loading">Loading…</div>';
    try { bars = meta.tradfi ? await API.yahooBars(meta.sym, st.tf) : await API.klines(meta.sym, st.tf, 1000); }
    catch (e) { if (g === gen) host.innerHTML = `<div class="loading">${esc(e.message)}</div>`; return; }
    if (g !== gen) return;
    build();
    if (bars.length) pxEl.textContent = bars[bars.length - 1].c.toLocaleString('en-US', { minimumFractionDigits: meta.prec, maximumFractionDigits: meta.prec });
    if (meta.tradfi) timers.push(setInterval(async () => { try { const b = await API.yahooBars(meta.sym, st.tf); if (g === gen) b.slice(-3).forEach(apply); } catch (e) { /* keep */ } }, 30000));
    else ws = API.liveKlines(meta.sym, st.tf, b => { if (g === gen) apply(b); });
    analysis(g);
    timers.push(setInterval(() => analysis(g), 5 * 60000));
  }
  load();
  return {
    state: () => Object.assign({}, st),
    rebuild: () => { if (meta && bars.length) build(); },
    setAlerts: () => { if (chart) chart.setAlerts(ctx.alertsFor(st.coin)); },
    reloadDrawings: coin => { if (coin === st.coin) build(); },
    destroy() { gen++; stop(); if (chart) chart.destroy(); chart = null; cell.innerHTML = ''; },
  };
}
