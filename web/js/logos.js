// Coin logos (CoinGecko, top ~1,000 coins, saved in this browser for a week) and simple icons for macro markets.
import * as API from './data.js';
import { esc } from './ui.js';

const KEY = 'lof_logos_v1';
let MAP = {};
try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && c.map) MAP = c.map; } catch (e) { /* ignore */ }
const listeners = [];
export const onLogos = fn => listeners.push(fn);

const MACRO = { GOLD: ['Au', '#c9a227'], SILVER: ['Ag', '#9ea7b3'], SPX: ['S&P', '#1e88e5'], NDX: ['NQ', '#5e35b1'], DXY: ['$', '#2e7d32'],
  US2Y: ['2Y', '#6d4c41'], US10Y: ['10Y', '#6d4c41'], US30Y: ['30Y', '#6d4c41'], VIX: ['VIX', '#c62828'], OIL: ['OIL', '#37474f'], ETHBTC: ['Ξ/₿', '#546e7a'] };
const bare = k => String(k).replace(/^(1000000|100000|10000|1000|1M)(?=[A-Z])/, '').toUpperCase();
const hue = k => [...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

export async function loadLogos() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); if (c && Date.now() - c.at < 7 * 86400e3 && Object.keys(c.map).length > 200) return; } catch (e) { /* refresh */ }
  const map = {};
  for (let page = 1; page <= 4; page++) {
    try {
      const j = await API.cg('coins/markets', { vs_currency: 'usd', order: 'market_cap_desc', per_page: 250, page });
      (j || []).forEach(c => { const s = String(c.symbol || '').toUpperCase(); if (s && c.image && !map[s]) map[s] = c.image.replace('/large/', '/small/'); });
    } catch (e) { break; }
  }
  if (Object.keys(map).length) {
    MAP = Object.assign({}, MAP, map);
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), map: MAP })); } catch (e) { /* ignore */ }
    listeners.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  }
}

// html for a round logo; falls back to a coloured letter
export function logo(key, size = 18) {
  const k = String(key || ''), st = `width:${size}px;height:${size}px;flex:0 0 ${size}px`;
  if (MACRO[k]) { const [t, c] = MACRO[k]; return `<b class="logo ltxt" style="${st};background:${c};font-size:${Math.max(7, size * (t.length > 2 ? 0.36 : 0.5))}px">${esc(t)}</b>`; }
  const url = MAP[bare(k)];
  if (url) return `<img class="logo" src="${esc(url)}" alt="" loading="lazy" style="${st}" onerror="this.replaceWith(Object.assign(document.createElement('b'),{className:'logo ltxt',textContent:'${esc(bare(k)[0] || '?')}',style:'${st};background:hsl(${hue(k)} 55% 45%);font-size:${size * 0.55}px'}))">`;
  return `<b class="logo ltxt" style="${st};background:hsl(${hue(k)} 55% 45%);font-size:${size * 0.55}px">${esc((bare(k)[0]) || '?')}</b>`;
}
