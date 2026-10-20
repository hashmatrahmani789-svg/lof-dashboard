// TradingView-style watchlist: several lists, unlimited symbols, live last / change / volume, drag to reorder.
// Lists are saved in this browser and synced to the cloud when storage is connected (same lists on phone and PC).
import * as API from './data.js';
import { esc, fp, fpct, toast, $ } from './ui.js';
import { logo, onLogos } from './logos.js';

const KEY = 'lof_wl_v1';
const CRYPTO_DEFAULT = ['BTC', 'ETH', 'ZEC', 'NEAR', 'VVV', 'HYPE', 'SOL', 'SUI', 'TAO', 'LINK'];

export function createWatchlist(ctx) {
  // ctx: { byBase(), tradfi, onPick(key), current(), scanInfo(key), fallbackWatch, onChange() }
  let W;
  try { W = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { W = null; }
  if (!W || !Array.isArray(W.lists) || !W.lists.length) {
    W = { lists: [{ name: 'Main', items: (ctx.fallbackWatch || ['BTC', 'ETH', 'SOL', 'GOLD', 'SILVER', 'SPX', 'NDX']).slice() }, { name: 'Alt coins', items: CRYPTO_DEFAULT.slice() }],
      active: 0, scan: 1, at: 0 };
  }
  let prices = {}, prev = {}, sortBy = null, sortDir = -1, cloud = false, pushTimer = null, dragKey = null;

  const list = () => W.lists[W.active] || W.lists[0];
  const items = () => list().items;
  function save(push = true) {
    W.at = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(W)); } catch (e) { /* ignore */ }
    if (push && cloud) { clearTimeout(pushTimer); pushTimer = setTimeout(() => API.storePut('lists', W).catch(() => {}), 800); }
    ctx.onChange && ctx.onChange();
  }

  // ── prices: all Binance futures in one call every 4 s; macro / futures from Yahoo every 60 s
  async function pollCrypto() {
    try {
      const t = await API.allTickers();
      const map = ctx.byBase();
      for (const k of new Set(W.lists.flatMap(l => l.items))) {
        const m = map[k]; if (!m || !t[m.sym]) continue;
        prev[k] = prices[k] ? prices[k].last : null;
        prices[k] = t[m.sym];
      }
      render();
    } catch (e) { /* keep last */ }
  }
  async function pollTradfi() {
    const keys = [...new Set(W.lists.flatMap(l => l.items))].filter(k => ctx.tradfi[k]);
    await Promise.all(keys.map(async k => {
      try {
        const { bars } = await API.yahooRaw(ctx.tradfi[k].t, '1d', '5d');
        if (bars.length < 2) return;
        const a = bars[bars.length - 1], b = bars[bars.length - 2];
        prev[k] = prices[k] ? prices[k].last : null;
        prices[k] = { last: a.c, chg: (a.c / b.c - 1) * 100, vol: a.v };
      } catch (e) { /* ignore */ }
    }));
    render();
  }

  // ── rendering
  const panel = $('#wlPanel');
  const label = k => ctx.tradfi[k] ? ctx.tradfi[k].short : k;
  const hue = k => [...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const vol = v => !v ? '' : v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
  function render() {
    if (!panel) return;
    $('#wlName').innerHTML = `${esc(list().name)} <span class="muted">▾</span>`;
    let keys = items().slice();
    if (sortBy) {
      const val = k => sortBy === 'sym' ? k : prices[k] ? prices[k][sortBy] : -Infinity;
      keys.sort((a, b) => sortBy === 'sym' ? sortDir * a.localeCompare(b) : sortDir * ((val(a) || 0) - (val(b) || 0)));
    }
    panel.querySelectorAll('.wl-cols [data-s]').forEach(h => { h.dataset.arrow = h.dataset.s === sortBy ? (sortDir > 0 ? '↑' : '↓') : ''; });
    const cur = ctx.current();
    $('#wlRows').innerHTML = keys.length ? keys.map(k => {
      const p = prices[k], info = ctx.scanInfo(k);
      const flash = p && prev[k] != null && p.last !== prev[k] ? (p.last > prev[k] ? 'fu' : 'fd') : '';
      const sig = !info ? '' : info.decision !== 'WAIT' ? `<i class="sig ${info.decision === 'LONG' ? 'l' : 's'}" title="${info.decision} READY · ${esc(info.setup)}"></i>` : info.setup !== 'NONE' ? '<i class="sig w" title="Setup forming"></i>' : '';
      return `<div class="wl-row ${k === cur ? 'on' : ''}" draggable="${sortBy ? 'false' : 'true'}" data-k="${esc(k)}">
        <span class="sym">${logo(k, 18)}${esc(label(k))}${sig}</span>
        <span class="num ${flash}">${p ? fp(p.last) : '…'}</span>
        <span class="num ${p ? (p.chg >= 0 ? 'up' : 'dn') : ''}">${p ? fpct(p.chg) : ''}</span>
        <span class="num muted">${p ? vol(p.vol) : ''}</span>
        <button class="rm" data-rm="${esc(k)}" title="Remove">✕</button></div>`;
    }).join('') : '<div class="empty">Empty list. Click ＋ to add symbols.</div>';
    $('#wlRows').querySelectorAll('.wl-row').forEach(r => {
      r.onclick = e => { if (e.target.dataset.rm) return; ctx.onPick(r.dataset.k); };
      r.ondragstart = () => { dragKey = r.dataset.k; r.classList.add('drag'); };
      r.ondragend = () => { dragKey = null; r.classList.remove('drag'); };
      r.ondragover = e => { e.preventDefault(); };
      r.ondrop = e => {
        e.preventDefault(); const to = r.dataset.k; if (!dragKey || dragKey === to) return;
        const it = items(), from = it.indexOf(dragKey); it.splice(from, 1); it.splice(it.indexOf(to), 0, dragKey); save(); render();
      };
    });
    $('#wlRows').querySelectorAll('[data-rm]').forEach(b => b.onclick = e => { e.stopPropagation(); list().items = items().filter(k => k !== b.dataset.rm); save(); render(); });
  }

  // ── list menu: switch, new, rename, delete, use for Telegram alerts
  function menu() {
    const m = $('#wlMenu');
    if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = W.lists.map((l, i) => `<div class="it ${i === W.active ? 'on' : ''}" data-i="${i}"><span>${esc(l.name)}</span><small>${l.items.length}${i === W.scan ? ' · 📨 Telegram' : ''}</small></div>`).join('') +
      `<hr><div class="it" data-a="new">＋ New list</div><div class="it" data-a="rename">✎ Rename "${esc(list().name)}"</div>
       <div class="it" data-a="scan">📨 Use "${esc(list().name)}" for Telegram setup alerts</div><div class="it dn" data-a="delete">🗑 Delete "${esc(list().name)}"</div>`;
    m.hidden = false;
    m.querySelectorAll('[data-i]').forEach(d => d.onclick = () => { W.active = +d.dataset.i; m.hidden = true; save(); render(); });
    m.querySelectorAll('[data-a]').forEach(d => d.onclick = () => {
      const a = d.dataset.a; m.hidden = true;
      if (a === 'new') { const n = prompt('Name of the new list', 'List ' + (W.lists.length + 1)); if (n) { W.lists.push({ name: n.slice(0, 30), items: [] }); W.active = W.lists.length - 1; } }
      if (a === 'rename') { const n = prompt('New name', list().name); if (n) list().name = n.slice(0, 30); }
      if (a === 'scan') { W.scan = W.active; toast(cloud ? `Telegram setup alerts now watch "${esc(list().name)}" (crypto only, first 25).` : 'Connect storage (see README) so the Telegram scanner can read this list. Until then it uses WATCHLIST.', 6000); }
      if (a === 'delete') { if (W.lists.length < 2) { toast('Keep at least one list.'); return; } if (!confirm(`Delete "${list().name}"?`)) return; W.lists.splice(W.active, 1); W.active = 0; if (W.scan >= W.lists.length) W.scan = 0; }
      save(); render();
    });
  }

  // ── add symbols (search box inside the panel)
  function openSearch() {
    const box = $('#wlSearch'), inp = box.querySelector('input'), res = box.querySelector('.res');
    box.hidden = !box.hidden;
    if (box.hidden) return;
    inp.value = ''; res.innerHTML = ''; inp.focus();
    inp.oninput = () => {
      const v = inp.value.trim().toUpperCase(); if (!v) { res.innerHTML = ''; return; }
      const all = Object.keys(ctx.tradfi).map(k => [k, ctx.tradfi[k].name]).concat(Object.values(ctx.byBase()).map(s => [s.base, s.sym]));
      const hits = all.filter(([k, n]) => k.startsWith(v) || k.replace(/^1000+/, '').startsWith(v) || n.toUpperCase().includes(v))
        .sort((x, y) => (y[0] === v) - (x[0] === v) || x[0].length - y[0].length).slice(0, 12);
      res.innerHTML = hits.map(([k, n]) => `<div class="it" data-k="${esc(k)}"><b>${esc(k)}</b> <small>${esc(n)}</small><span>${items().includes(k) ? '✓' : '＋'}</span></div>`).join('') || '<div class="it muted">No match</div>';
      res.querySelectorAll('[data-k]').forEach(d => d.onclick = () => { add(d.dataset.k); inp.oninput(); });
    };
    inp.onkeydown = e => { if (e.key === 'Enter') { const f = res.querySelector('[data-k]'); if (f) { add(f.dataset.k); inp.value = ''; res.innerHTML = ''; } } if (e.key === 'Escape') box.hidden = true; };
  }
  function add(k) { if (!items().includes(k)) { items().push(k); save(); render(); pollCrypto(); pollTradfi(); } }

  if (panel) {
    $('#wlName').onclick = menu;
    $('#wlAdd').onclick = openSearch;
    panel.querySelectorAll('.wl-cols [data-s]').forEach(h => h.onclick = () => {
      const s = h.dataset.s;
      if (sortBy === s) { if (sortDir === -1) sortDir = 1; else { sortBy = null; } } else { sortBy = s; sortDir = s === 'sym' ? 1 : -1; }
      render();
    });
  }

  // cloud copy wins when it is newer (lists edited on another device)
  async function syncFromCloud() {
    try {
      const j = await API.storeGet('lists');
      cloud = !!j.enabled;
      if (cloud && j.value && j.value.lists && (j.value.at || 0) > (W.at || 0)) { W = Object.assign(W, j.value); save(false); render(); }
      else if (cloud && (!j.value || (W.at || 0) > (j.value.at || 0))) API.storePut('lists', W).catch(() => {});
    } catch (e) { cloud = false; }
  }

  render();
  onLogos(render);
  pollCrypto(); pollTradfi(); syncFromCloud();
  setInterval(() => { if (document.visibilityState === 'visible') pollCrypto(); }, 4000);
  setInterval(pollTradfi, 60000);
  setInterval(syncFromCloud, 120000);
  return {
    keys: () => items().slice(),
    allKeys: () => [...new Set(W.lists.flatMap(l => l.items))],
    price: k => prices[k],
    prices: () => prices,
    render, add,
    cloud: () => cloud,
  };
}
