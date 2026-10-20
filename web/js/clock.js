// Clock with a selectable time zone (like TradingView's bottom-right clock), world clocks, and the economic calendar tab.
import * as API from './data.js';
import { esc, $ } from './ui.js';

export const ZONES = [
  ['local', 'Local (this device)'], ['UTC', 'UTC'], ['America/New_York', 'New York'], ['America/Chicago', 'Chicago'],
  ['America/Los_Angeles', 'Los Angeles'], ['America/Toronto', 'Toronto'], ['America/Sao_Paulo', 'São Paulo'], ['Europe/London', 'London'],
  ['Europe/Berlin', 'Berlin'], ['Europe/Paris', 'Paris'], ['Europe/Zurich', 'Zurich'], ['Europe/Istanbul', 'Istanbul'], ['Europe/Moscow', 'Moscow'],
  ['Asia/Dubai', 'Dubai'], ['Asia/Tehran', 'Tehran'], ['Asia/Kabul', 'Kabul'], ['Asia/Karachi', 'Karachi'], ['Asia/Kolkata', 'Kolkata'],
  ['Asia/Bangkok', 'Bangkok'], ['Asia/Singapore', 'Singapore'], ['Asia/Hong_Kong', 'Hong Kong'], ['Asia/Shanghai', 'Shanghai'],
  ['Asia/Tokyo', 'Tokyo'], ['Asia/Seoul', 'Seoul'], ['Australia/Sydney', 'Sydney'], ['Pacific/Auckland', 'Auckland'],
];
const WORLD = [['America/New_York', 'New York'], ['Europe/London', 'London'], ['Asia/Tokyo', 'Tokyo'], ['Asia/Kabul', 'Kabul'], ['UTC', 'UTC']];
const zoneOpt = tz => (tz === 'local' ? undefined : tz);

export function utcLabel(tz) {
  const off = tz === 'local' ? -new Date().getTimezoneOffset() : offsetMin(tz);
  const s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `UTC${s}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}
function offsetMin(tz) {
  const d = new Date(), p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}
export const fmtTime = (t, tz, o = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) => new Date(t * 1000).toLocaleString('en-GB', Object.assign({ timeZone: zoneOpt(tz) }, o));
const zoneName = tz => (ZONES.find(z => z[0] === tz) || [tz, tz])[1];

export function createClock(ctx) {
  // ctx: { tz(), setTz(tz) }
  const el = $('#clock');
  function tick() {
    const tz = ctx.tz(), now = Date.now() / 1000;
    el.innerHTML = `<span class="num">${fmtTime(now, tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</span> <span class="muted">${utcLabel(tz)}</span>`;
    el.title = `${zoneName(tz)} · ${fmtTime(now, tz, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}\nClick to change the time zone (chart, calendar and news use it).`;
    const pop = $('#clockPop');
    if (!pop.hidden) pop.querySelectorAll('[data-w]').forEach(w => { w.querySelector('.num').textContent = fmtTime(now, w.dataset.w); });
  }
  function menu() {
    const pop = $('#clockPop'), tz = ctx.tz(), now = Date.now() / 1000;
    if (!pop.hidden) { pop.hidden = true; return; }
    pop.innerHTML = `<h4>World clock</h4><div class="world">${WORLD.map(([z, n]) => `<div data-w="${z}"><span>${n}</span><span class="num">${fmtTime(now, z)}</span></div>`).join('')}</div>
      <h4>Time zone</h4><div class="zl">${ZONES.map(([z, n]) => `<div class="it ${z === tz ? 'on' : ''}" data-z="${z}"><span>${esc(n)}</span><small>${utcLabel(z)}</small></div>`).join('')}</div>`;
    pop.hidden = false;
    pop.querySelectorAll('[data-z]').forEach(d => d.onclick = () => { pop.hidden = true; ctx.setTz(d.dataset.z); tick(); });
  }
  el.onclick = e => { e.stopPropagation(); menu(); };
  $('#clockPop').onclick = e => e.stopPropagation();
  document.addEventListener('click', () => { $('#clockPop').hidden = true; });
  tick(); setInterval(tick, 1000);
  return { tick };
}

// ── Economic calendar tab (Forex Factory, this week) ─────────
const FLAGS = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CNY: '🇨🇳', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭' };
export function createCalendar(ctx) {
  // ctx: { tz(), prefs() → {cur, imp}, setPrefs(p) }
  let events = null, err = null;
  async function load() {
    try {
      events = (await API.calendar()).map(e => ({ title: e.title, cur: e.country, impact: e.impact, t: Date.parse(e.date) / 1000, f: e.forecast, p: e.previous, a: e.actual }))
        .filter(e => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
      err = null;
    } catch (e) { err = e.message; }
    render();
  }
  const cd = s => { s = Math.max(0, s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  function render() {
    const host = $('#tab-calendar'); if (!host || host.hidden) return;
    const P = ctx.prefs(), tz = ctx.tz(), now = Date.now() / 1000;
    if (!events) { host.innerHTML = `<div class="muted">${err ? 'Calendar unavailable: ' + esc(err) : 'Loading calendar…'}</div>`; return; }
    const imp = { high: ['High'], med: ['High', 'Medium'], all: ['High', 'Medium', 'Low', 'Holiday', 'Non-Economic'] }[P.imp];
    const ev = events.filter(e => (P.cur === 'all' || e.cur === 'USD') && imp.includes(e.impact));
    const next = ev.find(e => e.t > now);
    let lastDay = '';
    const rowsHtml = ev.map(e => {
      const day = fmtTime(e.t, tz, { weekday: 'long', day: '2-digit', month: 'short' });
      const head = day !== lastDay ? `<div class="cal-day">${esc(day)}</div>` : ''; lastDay = day;
      const past = e.t < now, isNext = next && e === next;
      const allDay = new Date(e.t * 1000).getUTCSeconds() === 0 && /All Day|Tentative/i.test(e.title);
      return head + `<div class="cal-row ${past ? 'past' : ''} ${isNext ? 'next' : ''}">
        <span class="num">${allDay ? 'All day' : fmtTime(e.t, tz)}</span>
        <span class="cur">${FLAGS[e.cur] || ''} ${esc(e.cur)}</span>
        <span class="imp i-${esc((e.impact || '').toLowerCase())}" title="${esc(e.impact)} impact"></span>
        <span class="ttl">${esc(e.title)}${isNext ? ` <span class="pill p-amber">in ${cd(e.t - now)}</span>` : ''}</span>
        <span class="num v" title="Actual">${esc(e.a || '')}</span><span class="num v muted" title="Forecast">${esc(e.f || '')}</span><span class="num v muted" title="Previous">${esc(e.p || '')}</span></div>`;
    }).join('');
    host.innerHTML = `<div class="cal-bar">
        <div class="seg" id="calCur"><button data-c="usd" class="${P.cur === 'usd' ? 'on' : ''}">USD</button><button data-c="all" class="${P.cur === 'all' ? 'on' : ''}">All currencies</button></div>
        <div class="seg" id="calImp"><button data-ci="high" class="${P.imp === 'high' ? 'on' : ''}">High</button><button data-ci="med" class="${P.imp === 'med' ? 'on' : ''}">High + Medium</button><button data-ci="all" class="${P.imp === 'all' ? 'on' : ''}">All</button></div>
        <span class="sp"></span><span class="muted">Times: ${esc(zoneName(tz))} (${utcLabel(tz)})</span></div>
      <div class="cal-row cal-h"><span>Time</span><span>Cur.</span><span></span><span>Event</span><span>Actual</span><span>Forecast</span><span>Previous</span></div>
      <div class="cal-list">${rowsHtml || '<div class="empty">No events for this filter.</div>'}</div>
      <div class="muted" style="font-size:11px;margin-top:6px">Forex Factory · this week · refreshes every 30 min. Red = high impact, orange = medium, yellow = low.</div>`;
    host.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { ctx.setPrefs({ cur: b.dataset.c }); render(); });
    host.querySelectorAll('#calImp [data-ci]').forEach(b => b.onclick = () => { ctx.setPrefs({ imp: b.dataset.ci }); render(); });
    const n = host.querySelector('.cal-row.next'); if (n && !host.dataset.scrolled) { host.dataset.scrolled = 1; n.scrollIntoView({ block: 'nearest' }); }
  }
  load(); setInterval(load, 30 * 60000); setInterval(render, 30000);
  return { render, load };
}
