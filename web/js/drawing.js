// TradingView-style drawing tools for Lightweight Charts.
// Tools: trend line, ray, horizontal line / ray, vertical line, parallel channel, rectangle, fib retracement,
// long / short position, measure (Shift + click), text. Click a drawing to select it, drag it or its handles,
// change its colour, Delete to remove. Ctrl+Z / Ctrl+Y undo / redo. Saved per market in this browser.

const ICON = {
  cursor: '<path d="M5 3l12 8-5.5 1.2L14 18l-2.2 1-2.6-5.6L5 17z"/>',
  trend: '<path d="M4 18L18 5"/><circle cx="4" cy="18" r="1.8"/><circle cx="18" cy="5" r="1.8"/>',
  ray: '<path d="M4 17L20 7"/><circle cx="4" cy="17" r="1.8"/><circle cx="11" cy="12.6" r="1.8"/>',
  h: '<path d="M2 11h18"/><circle cx="11" cy="11" r="1.8"/>',
  hray: '<path d="M6 11h14"/><circle cx="6" cy="11" r="1.8"/>',
  v: '<path d="M11 2v18"/><circle cx="11" cy="11" r="1.8"/>',
  channel: '<path d="M3 15L15 4M7 19L19 8"/>',
  rect: '<rect x="4" y="6" width="14" height="10" rx="1"/>',
  fib: '<path d="M3 5h16M3 9h16M3 13h16M3 17h16"/><path d="M4 18L18 4" stroke-dasharray="2 2"/>',
  long: '<path d="M4 4h14v6H4z" fill="currentColor" fill-opacity=".25"/><path d="M4 10h14v8H4z"/>',
  short: '<path d="M4 4h14v8H4z"/><path d="M4 12h14v6H4z" fill="currentColor" fill-opacity=".25"/>',
  measure: '<path d="M3 17L17 3M3 17h5M3 17v-5M17 3h-5M17 3v5"/>',
  text: '<path d="M5 5h12M11 5v13"/>',
  magnet: '<path d="M6 4v7a5 5 0 0010 0V4h-3v7a2 2 0 01-4 0V4z"/>',
  eye: '<path d="M2 11s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="11" cy="11" r="2.5"/>',
  lock: '<rect x="5" y="10" width="12" height="9" rx="1.5"/><path d="M8 10V7a3 3 0 016 0v3"/>',
  undo: '<path d="M8 6L4 10l4 4"/><path d="M4 10h9a5 5 0 010 10h-3"/>',
  redo: '<path d="M14 6l4 4-4 4"/><path d="M18 10H9a5 5 0 000 10h3"/>',
  trash: '<path d="M4 6h14M9 6V4h4v2M6 6l1 13h8l1-13"/>',
};
const svg = k => `<svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const TOOLS = [
  ['cursor', 'Cursor (Esc)', 0], ['trend', 'Trend line (Alt+T)', 2], ['ray', 'Ray (Alt+Shift+T)', 2], ['h', 'Horizontal line (Alt+H)', 1],
  ['hray', 'Horizontal ray (Alt+J)', 1], ['v', 'Vertical line (Alt+V)', 1], ['channel', 'Parallel channel (Alt+P)', 3],
  ['rect', 'Rectangle (Alt+Shift+R)', 2], ['fib', 'Fib retracement (Alt+F)', 2], ['long', 'Long position (Alt+L)', 3],
  ['short', 'Short position (Alt+S)', 3], ['measure', 'Measure (Shift + click)', 2], ['text', 'Text (Alt+N)', 1],
];
const NEED = Object.fromEntries(TOOLS.map(t => [t[0], t[2]]));
const HINT = { trend: 'Click 2 points', ray: 'Click 2 points', h: 'Click a price', hray: 'Click the start', v: 'Click a time', channel: 'Click 2 points for the line, then a 3rd for the width',
  rect: 'Click 2 corners', fib: 'Click the swing start, then the swing end', long: 'Click entry, then stop, then target', short: 'Click entry, then stop, then target',
  measure: 'Click the end point', text: 'Click where the text goes' };
const COLORS = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#787b86', '#ffffff', '#000000'];
const FIB = [0, 0.236, 0.382, 0.5, 0.62, 0.705, 0.79, 1];
const UP = '#26a69a', DN = '#ef5350';

export function attachDrawing(o) {
  const { chart, cs, el, root, C, X, Y, timeToLogical, logicalToTime, fmt, coin, primitive, LC, paneW, STEP, onAlert, onSave } = o;
  const ts = chart.timeScale();
  const KEY = 'lof_draw_' + coin;

  // ── state (with migration from the old format)
  let shapes = [];
  try {
    shapes = JSON.parse(localStorage.getItem(KEY) || '[]').map(s => {
      if (s.pts) return s;
      const pts = [{ t: s.t1, p: s.p1 }];
      if (s.type === 'long' || s.type === 'short') pts.push({ t: s.t2, p: s.p2 }, { t: s.t2, p: s.p3 });
      else if (s.t2 != null) pts.push({ t: s.t2, p: s.p2 });
      return { id: Math.random().toString(36).slice(2), type: s.type, pts, color: '#2962ff' };
    });
  } catch (e) { shapes = []; }
  if (Array.isArray(o.initial)) shapes = o.initial;          // newer copy from the cloud (synced between devices)
  let tool = 'cursor', pending = [], hover = null, magnet = true, hidden = false, locked = false;
  let selected = null, drag = null, measure = null, color = '#2962ff';
  const undoStack = [], redoStack = [];
  const snap = () => JSON.stringify(shapes);
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(shapes)); localStorage.setItem(KEY + '_at', String(Date.now())); } catch (e) { /* ignore */ }
    if (onSave) onSave(shapes);
  };
  const commit = before => { undoStack.push(before); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; save(); syncLines(); };

  // horizontal lines / rays get a price label on the axis
  let lines = [];
  function syncLines() {
    lines.forEach(l => cs.removePriceLine(l)); lines = [];
    if (hidden) return;
    shapes.filter(s => s.type === 'h' || s.type === 'hray').forEach(s => lines.push(cs.createPriceLine({ price: s.pts[0].p, color: s.color,
      lineVisible: false, axisLabelVisible: true, title: '' })));
  }
  syncLines();

  // ── geometry helpers
  const P = pt => ({ x: X(pt.t), y: Y(pt.p) });
  const ok = q => q.x != null && q.y != null;
  function distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    let u = L ? ((px - a.x) * dx + (py - a.y) * dy) / L : 0; u = Math.max(0, Math.min(1, u));
    return Math.hypot(px - (a.x + u * dx), py - (a.y + u * dy));
  }
  function rayEnd(a, b, W) { if (b.x === a.x) return { x: b.x, y: b.y }; const k = (b.y - a.y) / (b.x - a.x); const x = b.x >= a.x ? W : 0; return { x, y: a.y + k * (x - a.x) }; }
  function channelOffset(s) {          // price distance of the parallel line
    const [a, b, c] = s.pts; if (!c) return 0;
    const la = timeToLogical(a.t), lb = timeToLogical(b.t), lc = timeToLogical(c.t);
    const base = lb === la ? a.p : a.p + (b.p - a.p) * (lc - la) / (lb - la);
    return c.p - base;
  }
  const posEnd = s => Math.max(s.pts[1] ? s.pts[1].t : s.pts[0].t, s.pts[2] ? s.pts[2].t : 0);

  // ── drawing
  function seg(ctx, a, b, col, w, dash) { ctx.beginPath(); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = w || 1.6; ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); }
  function label(ctx, txt, x, y, col, bg, align) {
    ctx.font = '11px Inter, sans-serif'; const w = ctx.measureText(txt).width + 10;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (bg) { ctx.fillStyle = bg; ctx.beginPath(); (ctx.roundRect ? ctx.roundRect(x0, y - 13, w, 17, 3) : ctx.rect(x0, y - 13, w, 17)); ctx.fill(); }
    ctx.fillStyle = col; ctx.fillText(txt, x0 + 5, y);
  }
  function draw(ctx, s, W, H) {
    const pts = s.pts.map(P); if (!pts.every(ok)) return;
    const c = s.color || '#2962ff', [a, b, d] = pts;
    switch (s.type) {
      case 'trend': seg(ctx, a, b, c); break;
      case 'ray': seg(ctx, a, rayEnd(a, b, W), c); break;
      case 'h': seg(ctx, { x: 0, y: a.y }, { x: W, y: a.y }, c); break;
      case 'hray': seg(ctx, a, { x: W, y: a.y }, c); label(ctx, fmt(s.pts[0].p), a.x + 4, a.y - 5, c); break;
      case 'v': seg(ctx, { x: a.x, y: 0 }, { x: a.x, y: H }, c); break;
      case 'channel': {
        if (!b) break;
        const off = d ? Y(s.pts[0].p + channelOffset(s)) - a.y : 0;
        const a2 = { x: a.x, y: a.y + off }, b2 = { x: b.x, y: b.y + off };
        ctx.fillStyle = c + '22'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill();
        seg(ctx, a, b, c); seg(ctx, a2, b2, c); seg(ctx, { x: a.x, y: a.y + off / 2 }, { x: b.x, y: b.y + off / 2 }, c, 1, [4, 4]);
        break;
      }
      case 'rect': {
        if (!b) break;
        ctx.fillStyle = c + '26'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeStyle = c; ctx.lineWidth = 1.2; ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        break;
      }
      case 'fib': {
        if (!b) break;
        const p1 = s.pts[0].p, p2 = s.pts[1].p, pr = l => p2 + (p1 - p2) * l, x1 = Math.min(a.x, b.x);
        const ya = Y(pr(0.62)), yb = Y(pr(0.79));
        if (ya != null && yb != null) { ctx.fillStyle = 'rgba(249,168,37,0.13)'; ctx.fillRect(x1, Math.min(ya, yb), W - x1, Math.abs(yb - ya)); }
        FIB.forEach(l => {
          const y = Y(pr(l)); if (y == null) return;
          const col = l >= 0.62 && l <= 0.79 ? '#f9a825' : l === 0.5 ? '#9598a1' : c;
          seg(ctx, { x: x1, y }, { x: W, y }, col, 1); label(ctx, `${l} (${fmt(pr(l))})`, x1, y - 2, col);
        });
        seg(ctx, a, b, '#9598a1', 1, [4, 4]);
        break;
      }
      case 'long': case 'short': {
        if (!b) break;
        let x2 = X(posEnd(s)); if (x2 == null) break; if (x2 - a.x < 60) x2 = a.x + 140;
        const e = s.pts[0].p, sl = s.pts[1].p, tp = s.pts[2] ? s.pts[2].p : e + (e - sl) * 2;
        const ye = a.y, ys = Y(sl), yt = Y(tp); if (ys == null || yt == null) break;
        ctx.fillStyle = 'rgba(38,166,154,0.22)'; ctx.fillRect(a.x, Math.min(ye, yt), x2 - a.x, Math.abs(yt - ye));
        ctx.fillStyle = 'rgba(239,83,80,0.22)'; ctx.fillRect(a.x, Math.min(ye, ys), x2 - a.x, Math.abs(ys - ye));
        seg(ctx, { x: a.x, y: ye }, { x: x2, y: ye }, '#9598a1', 1);
        const risk = Math.abs(e - sl), rr = risk > 0 ? Math.abs(tp - e) / risk : 0, mid = (a.x + x2) / 2;
        label(ctx, `${s.type.toUpperCase()} · R:R ${rr.toFixed(2)}`, mid, ye - 4, '#fff', 'rgba(41,98,255,0.9)', 'center');
        label(ctx, `Target ${fmt(tp)} (${(Math.abs(tp - e) / e * 100).toFixed(2)}%)`, mid, yt + (yt < ye ? 16 : -4), '#fff', UP, 'center');
        label(ctx, `Stop ${fmt(sl)} (${(risk / e * 100).toFixed(2)}%)`, mid, ys + (ys > ye ? -4 : 16), '#fff', DN, 'center');
        break;
      }
      case 'measure': {
        if (!b) break;
        const up = s.pts[1].p >= s.pts[0].p, col = up ? 'rgba(41,98,255,' : 'rgba(239,83,80,';
        ctx.fillStyle = col + '0.18)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        seg(ctx, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, col + '1)', 1.2);
        seg(ctx, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, col + '1)', 1.2);
        const dp = s.pts[1].p - s.pts[0].p, pct = dp / s.pts[0].p * 100;
        const bars = Math.round(timeToLogical(s.pts[1].t) - timeToLogical(s.pts[0].t)), secs = Math.abs(s.pts[1].t - s.pts[0].t);
        const dur = secs >= 86400 ? `${Math.floor(secs / 86400)}d ${Math.round((secs % 86400) / 3600)}h` : `${Math.floor(secs / 3600)}h ${Math.round((secs % 3600) / 60)}m`;
        const ly = up ? Math.min(a.y, b.y) - 8 : Math.max(a.y, b.y) + 20;
        label(ctx, `${dp >= 0 ? '+' : ''}${fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) · ${bars} bars · ${dur}`, (a.x + b.x) / 2, ly, '#fff', col + '0.95)', 'center');
        break;
      }
      case 'text': {
        ctx.font = `600 ${s.lsize || 13}px Inter, sans-serif`; ctx.fillStyle = s.lcolor || c;
        String(s.text || 'Text').split('\n').forEach((ln, k) => ctx.fillText(ln, a.x, a.y + k * ((s.lsize || 13) + 3)));
        break;
      }
    }
    if (s.label && s.type !== 'text') shapeLabel(ctx, s, pts, W, H);
  }
  // text written on a line, box, channel, fib or position (like TradingView's "Text" tab)
  function shapeLabel(ctx, s, pts, W, H) {
    const [a, b] = pts, size = s.lsize || 12, col = s.lcolor || s.color || '#2962ff', pos = s.lpos || 'top';
    ctx.font = `600 ${size}px Inter, sans-serif`; ctx.fillStyle = col;
    const lines = String(s.label).split('\n'), lh = size + 3;
    const block = (x, y, align, base) => {       // base: 'above' | 'below' | 'middle'
      ctx.textAlign = align;
      const y0 = base === 'above' ? y - 6 - (lines.length - 1) * lh : base === 'below' ? y + size + 4 : y + size / 2 - 2 - (lines.length - 1) * lh / 2;
      lines.forEach((ln, k) => ctx.fillText(ln, x, y0 + k * lh));
      ctx.textAlign = 'left';
    };
    const vpos = pos === 'bottom' ? 'below' : pos === 'middle' ? 'middle' : 'above';
    switch (s.type) {
      case 'trend': case 'ray': case 'channel': {
        if (!b) return;
        const e = s.type === 'ray' ? rayEnd(a, b, W) : b, mx = (a.x + e.x) / 2, my = (a.y + e.y) / 2;
        const ang = Math.atan2(e.y - a.y, e.x - a.x), flip = Math.abs(ang) > Math.PI / 2;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(flip ? ang + Math.PI : ang); block(0, 0, 'center', vpos); ctx.restore();
        return;
      }
      case 'h': return block(W - 90, a.y, 'right', vpos);
      case 'hray': return block(a.x + 70, a.y, 'left', vpos);
      case 'v': { ctx.save(); ctx.translate(a.x, 30); ctx.rotate(Math.PI / 2); block(0, 0, 'left', 'above'); ctx.restore(); return; }
      case 'rect': case 'measure': {
        if (!b) return;
        const x = (a.x + b.x) / 2, top = Math.min(a.y, b.y), bot = Math.max(a.y, b.y);
        if (pos === 'top') return block(x, top + 4 + size * 0 , 'center', 'below');
        if (pos === 'bottom') return block(x, bot - 4, 'center', 'above');
        return block(x, (top + bot) / 2, 'center', 'middle');
      }
      case 'fib': if (b) block(Math.min(a.x, b.x), Math.min(a.y, b.y) - 14, 'left', 'above'); return;
      case 'long': case 'short': block(a.x, Math.min(...pts.map(q => q.y)) - 4, 'left', 'above'); return;
    }
  }
  function handles(ctx, s) {
    s.pts.forEach(pt => {
      const q = P(pt); if (!ok(q)) return;
      ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = s.color || '#2962ff'; ctx.lineWidth = 2; ctx.arc(q.x, q.y, 5, 0, 7); ctx.fill(); ctx.stroke();
    });
  }
  function preview() {
    if (!pending.length || !hover) return null;
    const pts = pending.concat([hover]);
    return { type: tool, pts, color, text: '' };
  }
  const redraw = primitive('top', ({ context: ctx, mediaSize }) => {
    const W = paneW(mediaSize), H = mediaSize.height;
    if (!hidden) shapes.forEach(s => draw(ctx, s, W, H));
    if (measure) draw(ctx, measure, W, H);
    const pv = preview(); if (pv) { ctx.globalAlpha = 0.75; draw(ctx, pv, W, H); ctx.globalAlpha = 1; }
    if (selected && !hidden) handles(ctx, selected);
    if (tool !== 'cursor') pending.forEach(pt => { const q = P(pt); if (ok(q)) { ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(q.x, q.y, 3.5, 0, 7); ctx.fill(); } });
  });

  // ── hit testing (pixels)
  function hitShape(x, y) {
    if (hidden) return null;
    const W = ts.width();
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i], pts = s.pts.map(P); if (!pts.every(ok)) continue;
      const [a, b] = pts, near = 6;
      switch (s.type) {
        case 'trend': if (distSeg(x, y, a, b) < near) return s; break;
        case 'ray': if (distSeg(x, y, a, rayEnd(a, b, W)) < near) return s; break;
        case 'h': if (Math.abs(y - a.y) < near) return s; break;
        case 'hray': if (Math.abs(y - a.y) < near && x >= a.x - near) return s; break;
        case 'v': if (Math.abs(x - a.x) < near) return s; break;
        case 'channel': {
          const off = pts[2] ? Y(s.pts[0].p + channelOffset(s)) - a.y : 0;
          if (distSeg(x, y, a, b) < near || distSeg(x, y, { x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }) < near) return s;
          break;
        }
        case 'text': { const z = s.lsize || 13, ls = String(s.text || 'Text').split('\n'); if (x >= a.x - 4 && x <= a.x + z * 0.62 * Math.max(...ls.map(l => l.length)) + 8 && y >= a.y - z - 3 && y <= a.y + (ls.length - 1) * (z + 3) + 4) return s; break; }
        case 'fib': { const x1 = Math.min(a.x, b.x); if (x >= x1 && y >= Math.min(a.y, b.y) - 4 && y <= Math.max(a.y, b.y) + 4) return s; break; }
        case 'long': case 'short': {
          let x2 = X(posEnd(s)); if (x2 - a.x < 60) x2 = a.x + 140;
          const ys = pts[1].y, yt = pts[2] ? pts[2].y : a.y;
          if (x >= a.x && x <= x2 && y >= Math.min(ys, yt) && y <= Math.max(ys, yt)) return s; break;
        }
        default: { if (!b) break; if (x >= Math.min(a.x, b.x) - 3 && x <= Math.max(a.x, b.x) + 3 && y >= Math.min(a.y, b.y) - 3 && y <= Math.max(a.y, b.y) + 3) return s; }
      }
    }
    return null;
  }
  function hitHandle(s, x, y) {
    if (!s) return -1;
    return s.pts.findIndex(pt => { const q = P(pt); return ok(q) && Math.hypot(q.x - x, q.y - y) < 8; });
  }

  // point under the mouse (snaps to candle open / high / low / close when the magnet is on)
  function pointAt(x, y) {
    let p = cs.coordinateToPrice(y); const l = ts.coordinateToLogical(x);
    if (p == null || l == null) return null;
    const i = Math.round(l);
    if (magnet && i >= 0 && i < C.length) {
      const c = C[i], near = [c.open, c.high, c.low, c.close].reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a);
      const yy = Y(near); if (yy != null && Math.abs(yy - y) < 14) p = near;
    }
    return { t: logicalToTime(i), p };
  }
  const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }; };
  const inPricePane = (x, y) => x < ts.width() && y < chart.panes()[0].getHeight();

  // ── toolbar
  const bar = root.querySelector('.lc-tools'), hint = root.querySelector('.lc-hint');
  bar.innerHTML = TOOLS.map(([k, t]) => `<button data-tool="${k}" title="${t}">${svg(k === 'cursor' ? 'cursor' : k)}</button>`).join('') +
    `<hr><button data-act="magnet" title="Magnet: snap to candle open / high / low / close">${svg('magnet')}</button>` +
    `<button data-act="hide" title="Hide / show drawings">${svg('eye')}</button>` +
    `<button data-act="lock" title="Lock drawings">${svg('lock')}</button>` +
    `<button data-act="undo" title="Undo (Ctrl+Z)">${svg('undo')}</button>` +
    `<button data-act="redo" title="Redo (Ctrl+Y)">${svg('redo')}</button>` +
    `<button data-act="clear" title="Delete all drawings on this market">${svg('trash')}</button>`;
  const selBar = document.createElement('div');
  selBar.className = 'lc-sel';
  root.querySelector('.lc-wrap').appendChild(selBar);
  function renderSelBar() {
    if (!selected) { selBar.style.display = 'none'; return; }
    selBar.style.display = 'flex';
    selBar.innerHTML = COLORS.map(c => `<button class="sw ${selected.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}" title="Colour"></button>`).join('') +
      (selected.type !== 'measure' ? `<button class="tb ${editing ? 'on' : ''}" data-a="edit" title="Write text on this drawing (double-click it)">T Text</button>` : '') +
      (['h', 'hray', 'trend', 'ray'].includes(selected.type) ? '<button class="tb" data-a="alert" title="Alert when price crosses this line">🔔 Alert</button>' : '') +
      `<button class="tb" data-a="clone" title="Clone">Clone</button><button class="tb" data-a="del" title="Delete (Del)">${svg('trash')}</button>` +
      (editing ? textEditor(selected) : '');
    bindEditor();
    selBar.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const before = snap(); selected.color = b.dataset.c; color = b.dataset.c; commit(before); renderSelBar(); redraw(); });
    selBar.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a, before = snap();
      if (a === 'alert') {
        const s0 = selected;
        if (s0.type === 'h' || s0.type === 'hray') onAlert && onAlert({ kind: 'price', price: s0.pts[0].p });
        else onAlert && onAlert({ kind: 'line', line: { t1: s0.pts[0].t, p1: s0.pts[0].p, t2: s0.pts[1].t, p2: s0.pts[1].p } });
        return;
      }
      if (a === 'del') { shapes = shapes.filter(s => s !== selected); selected = null; }
      if (a === 'edit') { editing = !editing; renderSelBar(); if (editing) focusEditor(); return; }
      if (a === 'clone') {
        const step = STEP * 5, c2 = JSON.parse(JSON.stringify(selected));
        c2.id = Math.random().toString(36).slice(2); c2.pts.forEach(q => { q.t += step; }); shapes.push(c2); selected = c2;
      }
      commit(before); renderSelBar(); redraw();
    });
  }
  // inline text editor in the selection bar: text, size, colour, position
  let editing = false;
  const SIZES = [10, 12, 14, 18, 24];
  function textEditor(s0) {
    const isText = s0.type === 'text', val = isText ? (s0.text || '') : (s0.label || '');
    const posOpts = ['rect', 'measure'].includes(s0.type) ? [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] : [['top', 'Above'], ['middle', 'On line'], ['bottom', 'Below']];
    return `<div class="lc-ted"><textarea rows="2" placeholder="Write text… (Enter = new line)">${val.replace(/</g, '&lt;')}</textarea>
      <div class="row"><select data-e="size" title="Size">${SIZES.map(z => `<option value="${z}" ${(s0.lsize || (isText ? 13 : 12)) === z ? 'selected' : ''}>${z}px</option>`).join('')}</select>
      ${isText ? '' : `<select data-e="pos" title="Position">${posOpts.map(([k, n]) => `<option value="${k}" ${(s0.lpos || 'top') === k ? 'selected' : ''}>${n}</option>`).join('')}</select>`}
      <input type="color" data-e="color" value="${/^#[0-9a-f]{6}$/i.test(s0.lcolor || s0.color) ? (s0.lcolor || s0.color) : '#2962ff'}" title="Text colour">
      <button class="tb" data-e="ok">Done</button></div></div>`;
  }
  function focusEditor() { const t = selBar.querySelector('.lc-ted textarea'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  function bindEditor() {
    const box = selBar.querySelector('.lc-ted'); if (!box || !selected) return;
    const s0 = selected, before = snap(), ta = box.querySelector('textarea');
    const apply = () => { if (s0.type === 'text') s0.text = ta.value || 'Text'; else s0.label = ta.value; redraw(); };
    ta.oninput = apply;
    ['keydown', 'keyup', 'keypress'].forEach(ev => ta.addEventListener(ev, e => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Escape') done(); }));
    box.querySelectorAll('select, input').forEach(i => i.onchange = () => {
      if (i.dataset.e === 'size') s0.lsize = +i.value;
      if (i.dataset.e === 'pos') s0.lpos = i.value;
      if (i.dataset.e === 'color') s0.lcolor = i.value;
      redraw();
    });
    box.querySelector('[data-e=ok]').onclick = () => done();
    function done() { apply(); editing = false; commit(before); renderSelBar(); redraw(); }
  }
  function setTool(t) {
    tool = t; pending = []; hover = null;
    if (t !== 'cursor') { selected = null; renderSelBar(); }
    bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    hint.textContent = HINT[t] || ''; hint.style.display = HINT[t] ? 'block' : 'none';
    el.style.cursor = t === 'cursor' ? '' : 'crosshair';
    redraw();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snap()); shapes = JSON.parse(undoStack.pop()); selected = null; save(); syncLines(); renderSelBar(); redraw(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snap()); shapes = JSON.parse(redoStack.pop()); selected = null; save(); syncLines(); renderSelBar(); redraw(); }
  function clearAll() { if (!shapes.length || !confirm('Delete all drawings on ' + coin + '?')) return; const before = snap(); shapes = []; selected = null; commit(before); renderSelBar(); redraw(); }
  bar.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(tool === b.dataset.tool ? 'cursor' : b.dataset.tool));
  const btn = a => bar.querySelector(`[data-act=${a}]`);
  btn('magnet').classList.add('on');
  btn('magnet').onclick = () => { magnet = !magnet; btn('magnet').classList.toggle('on', magnet); };
  btn('hide').onclick = () => { hidden = !hidden; btn('hide').classList.toggle('on', hidden); selected = null; renderSelBar(); syncLines(); redraw(); };
  btn('lock').onclick = () => { locked = !locked; btn('lock').classList.toggle('on', locked); };
  btn('undo').onclick = undo; btn('redo').onclick = redo; btn('clear').onclick = clearAll;

  // ── placing points (clicks while a tool is active)
  function finishShape() {
    const before = snap();
    const s = { id: Math.random().toString(36).slice(2), type: tool, pts: pending.slice(0, NEED[tool]), color };
    if (tool === 'measure') { measure = s; setTool('cursor'); redraw(); return; }
    if (tool === 'text') s.text = 'Text';
    shapes.push(s); selected = s; commit(before);
    const wasText = tool === 'text';
    setTool('cursor'); editing = wasText; renderSelBar(); if (wasText) focusEditor(); redraw();
  }
  // clicks are read straight from the mouse (more reliable than the chart's click event for fast clicks)
  let press = null;
  function place(x, y) {
    const pt = pointAt(x, y); if (!pt) return;
    pending.push(pt);
    if (pending.length >= NEED[tool]) finishShape(); else redraw();
  }

  // ── select / move / edit with the mouse
  const onDown = e => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (!inPricePane(x, y)) return;
    if (tool === 'cursor' && e.shiftKey) {                // Shift + click: measure (like TradingView)
      const pt = pointAt(x, y); if (!pt) return;
      measure = null; setTool('measure'); pending = [pt]; redraw(); return;
    }
    if (tool !== 'cursor') { press = { x, y }; return; }   // placing a point: decided on mouse up
    if (measure) { measure = null; redraw(); }
    let s = selected && hitHandle(selected, x, y) >= 0 ? selected : hitShape(x, y);
    if (!s) { if (selected) { if (editing) { editing = false; commit(snap()); } selected = null; renderSelBar(); redraw(); } return; }
    const hIdx = hitHandle(s, x, y);
    if (selected !== s) editing = false;
    selected = s; renderSelBar(); redraw();
    if (locked) return;
    e.stopImmediatePropagation(); e.preventDefault();
    chart.applyOptions({ handleScroll: false, handleScale: false });
    drag = { s, hIdx, x0: x, y0: y, l0: ts.coordinateToLogical(x), p0: cs.coordinateToPrice(y), orig: JSON.parse(JSON.stringify(s.pts)), before: snap(), moved: false };
  };
  const onMove = e => {
    if (!drag) {
      if (tool === 'cursor' && !hidden) { const { x, y } = local(e); el.style.cursor = hitShape(x, y) ? 'pointer' : ''; }
      return;
    }
    e.stopPropagation();
    const { x, y } = local(e);
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
    drag.moved = true;
    if (drag.hIdx >= 0) {
      const pt = pointAt(x, y); if (pt) drag.s.pts[drag.hIdx] = pt;
    } else {
      const l = ts.coordinateToLogical(x), p = cs.coordinateToPrice(y);
      if (l == null || p == null || drag.l0 == null || drag.p0 == null) return;
      const dl = Math.round(l - drag.l0), dp = p - drag.p0;
      drag.s.pts = drag.orig.map(q => ({ t: logicalToTime(Math.round(timeToLogical(q.t)) + dl), p: q.p + dp }));
    }
    syncLines(); redraw();
  };
  const onUp = e => {
    if (press) {
      const { x, y } = local(e), p0 = press; press = null;
      if (tool !== 'cursor' && Math.hypot(x - p0.x, y - p0.y) < 5) place(x, y);
      return;
    }
    if (!drag) return;
    chart.applyOptions({ handleScroll: true, handleScale: true });
    if (drag.moved) commit(drag.before);
    drag = null; redraw();
  };
  el.addEventListener('pointerdown', onDown, true);
  const onDbl = e => {
    if (tool !== 'cursor') return;
    const { x, y } = local(e); const s0 = hitShape(x, y); if (!s0 || s0.type === 'measure') return;
    e.stopPropagation(); e.preventDefault();
    selected = s0; editing = true; renderSelBar(); focusEditor(); redraw();
  };
  el.addEventListener('dblclick', onDbl, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);

  // ── keyboard (TradingView shortcuts)
  const ALT = { KeyT: 'trend', KeyH: 'h', KeyJ: 'hray', KeyV: 'v', KeyP: 'channel', KeyF: 'fib', KeyL: 'long', KeyS: 'short', KeyN: 'text' };
  function onKey(e) {
    if (e.key === 'Escape') { if (tool !== 'cursor') setTool('cursor'); else { selected = null; measure = null; renderSelBar(); redraw(); } return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      const before = snap(); shapes = shapes.filter(s => s !== selected); selected = null; commit(before); renderSelBar(); redraw(); return true;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') { undo(); return true; }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) { redo(); return true; }
    if (e.altKey && e.shiftKey && e.code === 'KeyR') { setTool('rect'); return true; }
    if (e.altKey && e.shiftKey && e.code === 'KeyT') { setTool('ray'); return true; }
    if (e.altKey && !e.shiftKey && ALT[e.code]) { setTool(ALT[e.code]); return true; }
    return false;
  }

  function onCrosshair(param) {
    if (tool === 'cursor' || !param.point) return;
    hover = pointAt(param.point.x, param.point.y); redraw();
  }

  setTool('cursor');
  return {
    busy: () => tool !== 'cursor' || !!drag, onKey, onCrosshair, redraw,
    addHorizontal(p) { const before = snap(); shapes.push({ id: Math.random().toString(36).slice(2), type: 'h', pts: [{ t: C.length ? C[C.length - 1].time : 0, p }], color }); commit(before); redraw(); },
    destroy() { el.removeEventListener('dblclick', onDbl, true); el.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointermove', onMove, true); window.removeEventListener('pointerup', onUp, true); },
  };
}
