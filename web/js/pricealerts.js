// Price alerts like TradingView: price or trend line, crossing / crossing up / crossing down, once or every time.
// Checked here on live prices while the dashboard is open, and by the 5-minute server scanner when it is closed
// (needs cloud storage). Telegram, sound, browser notification and a pop-up.
import * as API from './data.js';
import { levelAt, runAlert, condText } from './alertlogic.js';
import { esc, fp, toast, $ } from './ui.js';

const KEY = 'lof_palerts_v1';

export function createAlerts(ctx) {
  // ctx: { byBase(), tradfi, current() → {key, sym, tradfi, price, prec}, server() → {storage, telegram}, onChange(list), onPick(key) }
  let list = [];
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
  let cloud = false;
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ } };
  const changed = () => { saveLocal(); renderPanel(); ctx.onChange && ctx.onChange(list); };
  const remote = body => { if (cloud) API.alertsDo(body).catch(() => {}); };
  const active = () => list.filter(a => a.status === 'active');

  async function pull() {
    try {
      const j = await API.alertsGet();
      if (!j.enabled) { cloud = false; return; }
      const first = !cloud; cloud = true;
      const mine = new Map(list.map(a => [a.id, a]));
      // alerts made before storage was connected are uploaded once
      if (first) list.filter(a => !j.alerts.some(c => c.id === a.id) && a.status === 'active').forEach(a => { API.alertsDo({ action: 'add', alert: a }).catch(() => {}); j.alerts.push(a); });
      list = j.alerts.map(c => {
        const m = mine.get(c.id);
        if (m && c.status === 'active' && (m.lastT || 0) > (c.lastT || 0)) return Object.assign({}, c, { side: m.side, lastT: m.lastT, lastFired: Math.max(m.lastFired || 0, c.lastFired || 0) });
        if (m && m.status !== 'active' && c.status === 'active' && (m.triggeredAt || 0) > (c.created || 0)) return Object.assign({}, c, { status: m.status, triggeredAt: m.triggeredAt });
        return c;
      });
      changed();
    } catch (e) { /* offline: keep local */ }
  }

  // ── checking ──────────────────────────────────────────────
  function feed(key, price, t = Math.floor(Date.now() / 1000)) {
    if (!Number.isFinite(price)) return;
    for (const a of active()) {
      if (a.key !== key) continue;
      const hit = runAlert(a, [{ t, h: price, l: price, c: price }]);
      if (!hit) continue;
      if (a.mode === 'every' && a.lastFired && t - a.lastFired < 60) continue;
      a.lastFired = t;
      if (a.mode !== 'every') { a.status = 'triggered'; a.triggeredAt = t; }
      remote({ action: 'update', id: a.id, patch: { status: a.status, triggeredAt: a.triggeredAt, lastFired: a.lastFired, side: a.side, lastT: a.lastT } });
      fire(a, hit);
      changed();
    }
  }
  async function poll() {
    const act = active(); if (!act.length) return;
    const cur = ctx.current();
    if (act.some(a => !a.tradfi && a.key !== cur.key)) {
      try { const t = await API.allTickers(); act.filter(a => !a.tradfi && a.key !== cur.key).forEach(a => t[a.sym] && feed(a.key, t[a.sym].last)); } catch (e) { /* ignore */ }
    }
  }
  async function pollTradfi() {
    const cur = ctx.current();
    const byKey = new Map(active().filter(a => a.tradfi && a.key !== cur.key).map(a => [a.key, a.sym]));
    for (const [k, sym] of byKey) {
      try { const { bars } = await API.yahooRaw(sym, '1m', '1d'); const b = bars[bars.length - 1]; if (b) feed(k, b.c); } catch (e) { /* ignore */ }
    }
  }
  let tgSync = 0;
  setInterval(() => { if (cloud && active().length && Date.now() - tgSync > 60000) { tgSync = Date.now(); active().forEach(a => remote({ action: 'update', id: a.id, patch: { side: a.side, lastT: a.lastT } })); } }, 20000);

  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach(d => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.15, ac.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + d + 0.15); o.start(ac.currentTime + d); o.stop(ac.currentTime + d + 0.16); });
    } catch (e) { /* ignore */ }
  }
  function fire(a, hit) {
    const prec = a.prec != null ? a.prec : 2;
    const text = `${a.label || a.key} ${condText(a.cond)} ${fp(hit.level, prec)}${a.kind === 'line' ? ' (trend line)' : ''}`;
    beep();
    toast(`🔔 <b>${esc(text)}</b>${a.msg ? '<br>' + esc(a.msg) : ''}`, 12000);
    if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('🔔 ' + text, { body: a.msg || 'Price ' + fp(hit.price, prec), tag: a.id }); } catch (e) { /* ignore */ } }
    const sv = ctx.server() || {};
    if (a.telegram && sv.telegram) API.sendTelegram(`🔔 <b>${esc(text)}</b>\nPrice ${fp(hit.price, prec)}${a.msg ? '\n' + esc(a.msg) : ''}`).catch(() => {});
  }

  // ── create / edit dialog ──────────────────────────────────
  function open(init = {}) {
    const cur = ctx.current();
    const a = Object.assign({ key: cur.key, sym: cur.sym, tradfi: cur.tradfi, prec: cur.prec, kind: 'price', price: cur.price, cond: 'cross', mode: 'once', msg: '', telegram: true }, init);
    const editing = !!init.id;
    const m = $('#modal'), sv = ctx.server() || {};
    const lvlNow = a.kind === 'line' ? levelAt(a, Date.now() / 1000) : a.price;
    m.innerHTML = `<div class="mbox">
      <h3><span>${editing ? 'Edit' : 'Create'} alert on <b>${esc(a.label || a.key)}</b></span> <button class="icon-btn" data-x>✕</button></h3>
      <div class="field"><span>Condition</span><select id="alCond">
        <option value="cross" ${a.cond === 'cross' ? 'selected' : ''}>Crossing</option>
        <option value="up" ${a.cond === 'up' ? 'selected' : ''}>Crossing up</option>
        <option value="down" ${a.cond === 'down' ? 'selected' : ''}>Crossing down</option></select></div>
      ${a.kind === 'line' ? `<div class="field"><span>Trend line</span><span class="num">now at ${fp(lvlNow, a.prec)}</span></div>`
        : `<div class="field"><span>Price</span><input type="number" step="any" id="alPrice" value="${+(+a.price).toFixed(a.prec)}"></div>`}
      <div class="field"><span>Trigger</span><div class="seg" id="alMode"><button data-m="once" class="${a.mode === 'once' ? 'on' : ''}">Only once</button><button data-m="every" class="${a.mode === 'every' ? 'on' : ''}">Every time</button></div></div>
      <div class="field"><span>Message</span><input type="text" id="alMsg" maxlength="200" placeholder="optional" value="${esc(a.msg)}"></div>
      <div class="field"><span>Send to Telegram ${sv.telegram ? '' : '<small class="muted">(not set up)</small>'}</span><input type="checkbox" id="alTg" ${a.telegram && sv.telegram ? 'checked' : ''} ${sv.telegram ? '' : 'disabled'}></div>
      <div class="muted" style="font-size:11.5px;line-height:1.5">${cloud ? '✓ Saved in the cloud: the scanner checks it every 5 minutes even when the dashboard is closed.' : 'Checked while the dashboard is open. Connect storage (README) so alerts also work when it is closed.'}</div>
      <div class="field" style="justify-content:flex-end;gap:8px"><button class="btn" data-x>Cancel</button><button class="btn primary" id="alSave">${editing ? 'Save' : 'Create'}</button></div></div>`;
    m.hidden = false;
    let mode = a.mode;
    m.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { m.hidden = true; });
    m.onclick = e => { if (e.target === m) m.hidden = true; };
    m.querySelectorAll('#alMode [data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; m.querySelectorAll('#alMode button').forEach(x => x.classList.toggle('on', x === b)); });
    const pi = $('#alPrice'); if (pi) { pi.focus(); pi.select(); }
    m.onkeydown = e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('#alSave').click(); if (e.key === 'Escape') m.hidden = true; };
    $('#alSave').onclick = () => {
      const price = pi ? +pi.value : a.price;
      if (a.kind === 'price' && !(price > 0)) { toast('Enter a price.'); return; }
      const now = Math.floor(Date.now() / 1000);
      const p0 = ctx.current().key === a.key ? ctx.current().price : null;
      const lv = a.kind === 'line' ? levelAt(a, now) : price;
      const out = Object.assign({}, a, { price, cond: $('#alCond').value, mode, msg: $('#alMsg').value.trim(), telegram: $('#alTg').checked,
        status: 'active', lastT: now, side: p0 != null ? (p0 >= lv ? 'above' : 'below') : (a.side || 'below') });
      if (p0 == null && !a.side) out.side = null;
      if (!editing) { out.id = Math.random().toString(36).slice(2, 10) + now.toString(36); out.created = now; out.label = ctx.tradfi[a.key] ? ctx.tradfi[a.key].short : ({ GOLD: 'Gold', SILVER: 'Silver' })[a.key] || a.key; }
      m.hidden = true;
      if (editing) { const i = list.findIndex(x => x.id === a.id); list[i] = out; remote({ action: 'update', id: out.id, patch: out }); }
      else { list.unshift(out); remote({ action: 'add', alert: out }); }
      if (!out.side) seedSide(out);
      toast(`🔔 Alert ${editing ? 'saved' : 'created'}: ${esc(out.label || out.key)} ${condText(out.cond)} ${fp(lv, out.prec)}`);
      changed();
    };
  }
  // alert on a market other than the open one: learn which side the price is on first
  async function seedSide(a) {
    try {
      let p;
      if (a.tradfi) { const { bars } = await API.yahooRaw(a.sym, '1m', '1d'); p = bars[bars.length - 1].c; }
      else p = (await API.allTickers())[a.sym].last;
      a.side = p >= levelAt(a, Date.now() / 1000) ? 'above' : 'below';
      remote({ action: 'update', id: a.id, patch: { side: a.side } }); saveLocal();
    } catch (e) { a.side = 'below'; }
  }

  // ── alerts panel (bell button) ────────────────────────────
  function renderPanel() {
    const n = active().length, b = $('#btnAlerts');
    if (b) b.innerHTML = `🔔${n ? `<span class="cnt">${n}</span>` : ''}`;
    const p = $('#alertsPanel'); if (!p || p.hidden) return;
    const row = a => {
      const lv = levelAt(a, Date.now() / 1000);
      return `<div class="al-row ${a.status}" data-id="${a.id}">
        <div class="al-main" data-go="${esc(a.key)}"><b>${esc(a.label || a.key)}</b> <span class="muted">${condText(a.cond)}</span> <span class="num">${fp(lv, a.prec)}</span>${a.kind === 'line' ? ' <small class="muted">trend line</small>' : ''}
          <div class="muted" style="font-size:11px">${a.status === 'active' ? (a.mode === 'every' ? 'Every time' : 'Once') : 'Triggered ' + new Date((a.triggeredAt || 0) * 1000).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}${a.telegram ? ' · Telegram' : ''}${a.msg ? ' · ' + esc(a.msg) : ''}</div></div>
        <div class="al-act">${a.status === 'active' ? `<button data-ed="${a.id}" title="Edit">✎</button>` : `<button data-re="${a.id}" title="Restart">↻</button>`}<button data-del="${a.id}" title="Delete">✕</button></div></div>`;
    };
    const act = list.filter(a => a.status === 'active'), done = list.filter(a => a.status !== 'active');
    p.innerHTML = `<h3>Alerts <span class="muted">${act.length} active</span><span class="sp"></span>
        <button class="btn" id="alNew">＋ Create</button>${act.length ? '<button class="btn" id="alDelAll" title="Delete all active alerts">Delete all</button>' : ''}<button class="icon-btn" id="alClose">✕</button></h3>
      <div class="al-list">${act.map(row).join('') || '<div class="empty">No active alerts. Press Alt+A on the chart, right-click a price, or select a line and press 🔔.</div>'}</div>
      ${done.length ? `<h4>Triggered <a href="#" id="alClear">clear</a></h4><div class="al-list">${done.slice(0, 50).map(row).join('')}</div>` : ''}
      <div class="muted" style="font-size:11px;margin-top:8px">${cloud ? 'Synced to the cloud · checked every 5 min when the dashboard is closed.' : 'Local only · checked while the dashboard is open.'}</div>`;
    $('#alClose').onclick = () => { p.hidden = true; };
    $('#alNew').onclick = () => open();
    const da = $('#alDelAll'); if (da) da.onclick = () => { if (!confirm(`Delete all ${act.length} active alerts?`)) return; act.forEach(a => remote({ action: 'delete', id: a.id })); list = list.filter(a => a.status !== 'active'); changed(); };
    const cl = $('#alClear'); if (cl) cl.onclick = e => { e.preventDefault(); list = list.filter(a => a.status === 'active'); remote({ action: 'clear' }); changed(); };
    p.querySelectorAll('[data-del]').forEach(x => x.onclick = () => { list = list.filter(a => a.id !== x.dataset.del); remote({ action: 'delete', id: x.dataset.del }); changed(); });
    p.querySelectorAll('[data-ed]').forEach(x => x.onclick = () => open(list.find(a => a.id === x.dataset.ed)));
    p.querySelectorAll('[data-re]').forEach(x => x.onclick = () => open(Object.assign({}, list.find(a => a.id === x.dataset.re))));
    p.querySelectorAll('[data-go]').forEach(x => x.onclick = () => ctx.onPick(x.dataset.go));
  }
  const bell = $('#btnAlerts');
  if (bell) bell.onclick = e => { e.stopPropagation(); const p = $('#alertsPanel'); p.hidden = !p.hidden; renderPanel(); };

  renderPanel();
  pull();
  setInterval(pull, 60000);
  setInterval(poll, 3000);
  setInterval(pollTradfi, 30000);
  // moved on the chart (dragged): new price or trend line; the side is worked out again from the current price
  function move(id, patch) {
    const a = list.find(x => x.id === id); if (!a) return;
    Object.assign(a, patch);
    const cur = ctx.current(), lv = levelAt(a, Date.now() / 1000);
    if (cur.key === a.key && Number.isFinite(cur.price)) a.side = cur.price >= lv ? 'above' : 'below'; else seedSide(a);
    a.lastT = Math.floor(Date.now() / 1000);
    remote({ action: 'update', id, patch: Object.assign({}, patch, { side: a.side, lastT: a.lastT }) });
    toast(`🔔 Alert moved to ${fp(lv, a.prec)}`, 2500);
    changed();
  }
  function remove(id) {
    const a = list.find(x => x.id === id); if (!a) return;
    list = list.filter(x => x.id !== id); remote({ action: 'delete', id });
    toast(`Alert deleted: ${esc(a.label || a.key)} ${fp(levelAt(a, Date.now() / 1000), a.prec)}`, 2500);
    changed();
  }
  return {
    open, feed, move, remove,
    edit: id => { const a = list.find(x => x.id === id); if (a) open(a); },
    forKey: key => list.filter(a => a.key === key),
    list: () => list,
    cloud: () => cloud,
  };
}
