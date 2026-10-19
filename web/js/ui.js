// Formatting + panel rendering.
import { isNum, LEVEL_NAMES, OPEN_NAMES } from './engine.js';

export const $ = s => document.querySelector(s);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function precFor(p) { const a = Math.abs(p); return a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8; }
export function fp(p, prec) {
  if (!isNum(p)) return '—';
  const d = prec != null ? prec : precFor(p);
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fusd(x) {
  if (!isNum(x)) return '—';
  const a = Math.abs(x), s = x < 0 ? '-' : '';
  return a >= 1e12 ? `${s}$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M`
    : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`;
}
export const fpct = (x, d = 2) => isNum(x) ? `${x > 0 ? '+' : ''}${x.toFixed(d)}%` : '—';
export const tone = v => !isNum(v) || v === 0 ? '' : v > 0 ? 'up' : 'dn';
export const pill = (t, c) => `<span class="pill p-${c}">${esc(t)}</span>`;
export const biasPill = b => b === 1 ? pill('BULL', 'up') : b === -1 ? pill('BEAR', 'dn') : pill('MIXED', 'grey');
export const tile = (l, v, n, cls = '', extra = '') =>
  `<div class="tile ${extra}"><div class="l">${l}</div><div class="v ${cls}">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
export const rows = items => `<div class="rows">${items.map(([k, v, cls]) => `<div class="row ${cls || ''}"><span>${k}</span><span>${v}</span></div>`).join('')}</div>`;
export function ago(sec) {
  if (!isNum(sec)) return '—';
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}
export function dur(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
export function sparkSvg(vals, up) {
  vals = (vals || []).filter(isNum);
  if (vals.length < 2) return '';
  const w = 120, h = 26, lo = Math.min(...vals), hi = Math.max(...vals), r = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - lo) / r * (h - 4)).toFixed(1)}`).join(' ');
  const col = (up == null ? vals[vals.length - 1] >= vals[0] : up) ? 'var(--up)' : 'var(--dn)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${col}" stroke-width="1.5" points="${pts}"/></svg>`;
}

let toastTimer;
export function toast(msg, ms = 3500) {
  const t = $('#toast'); t.innerHTML = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ── panels ──────────────────────────────────────────────────
export function renderHero(st, r) {
  const dec = r ? r.decision : '…';
  const decCls = dec === 'LONG' ? 'bg-up' : dec === 'SHORT' ? 'bg-dn' : r ? 'bg-amber' : 'bg-grey';
  const reg = r ? r.regime : ['…', '', 'neu'];
  const regCls = reg[2] === 'bull' ? 'bg-up' : reg[2] === 'bear' ? 'bg-dn' : 'bg-grey';
  const ch = st.chg24;
  $('#hero').innerHTML = `
    <div class="title"><div class="name">${esc(st.title)}</div><div class="sub">${st.sub}</div></div>
    <div class="px"><div class="l muted">${st.tradfi ? 'Price' : 'Price · Binance perp'}</div>
      <div class="v" id="heroPx">${fp(st.price, st.prec)}</div>
      <div class="c ${tone(ch)}">${isNum(ch) ? fpct(ch) + ' 24h' : ''}</div></div>
    <div class="badge ${decCls}"><div class="big">${dec}</div><div class="small">${r ? `score ${r.score}/9` : 'loading'}</div></div>
    <div class="badge wide ${regCls}"><div class="big">${esc(reg[0])}</div><div class="small">${esc(reg[1])}</div></div>`;
}

export function renderOverview(st, r, ov) {
  const el = $('#overview');
  if (st.tradfi) {
    const p = st.perf || {};
    el.innerHTML = !p.chg_24h && p.chg_24h !== 0 ? '' : [
      tile('24h', fpct(p.chg_24h), '', tone(p.chg_24h)), tile('1 week', fpct(p.chg_7d), '', tone(p.chg_7d)),
      tile('1 month', fpct(p.chg_30d), '', tone(p.chg_30d)),
      tile('52-week high', fp(p.hi_52w, st.prec), r ? fpct((r.price / p.hi_52w - 1) * 100, 1) + ' from price' : ''),
      tile('52-week low', fp(p.lo_52w, st.prec), r ? fpct((r.price / p.lo_52w - 1) * 100, 1) + ' from price' : '')].join('');
    return;
  }
  if (!ov) { el.innerHTML = ov === null ? '' : '<div class="tile"><div class="skel"></div><div class="skel"></div></div>'.repeat(4); return; }
  const mcFdv = ov.mcap && ov.fdv ? ov.mcap / ov.fdv * 100 : null;
  const oiMc = r && ov.mcap && isNum(r.oi_now) ? r.oi_now / ov.mcap * 100 : null;
  el.innerHTML = [
    tile('Market cap', fusd(ov.mcap), ov.rank ? `Rank #${ov.rank}` : ''),
    tile('FDV', fusd(ov.fdv), ov.max ? 'price × max supply' : 'price × total supply'),
    tile('MC / FDV', ov.inflationary ? 'No max supply' : mcFdv == null ? '—' : mcFdv.toFixed(0) + '%', ov.inflationary ? 'supply keeps growing' : 'low = unlock risk'),
    tile('24h volume', fusd(ov.volume)),
    tile('7d', fpct(ov.chg_7d), '', tone(ov.chg_7d)), tile('30d', fpct(ov.chg_30d), '', tone(ov.chg_30d)),
    tile('From ATH', fpct(ov.ath_chg, 1), `ATH ${fp(ov.ath)}`),
    tile('OI / MC', oiMc == null ? '—' : oiMc.toFixed(1) + '%', 'high = crowded'),
  ].join('');
}

export function renderPlan(st, r, onLtf, onJournal) {
  const ltfSeg = `<div class="seg" id="ltfSeg">${['5m', '15m', '1h'].map(t => `<button data-ltf="${t}" class="${t === st.ltf ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  let body;
  if (!r) body = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  else if (r.setup === 'NONE') {
    body = `<div style="margin-bottom:8px">${pill('NO SETUP', 'grey')}</div>` + rows([
      ['Long side', `${r.set_long !== 'NONE' ? esc(r.set_long) : 'no setup'} · ${r.score_long}/9`],
      ['Short side', `${r.set_short !== 'NONE' ? esc(r.set_short) : 'no setup'} · ${r.score_short}/9`],
      ['Waiting for', 'Setup A (sweep) or B (pullback)'], ['Price', `<span class="num">${fp(r.price, st.prec)}</span>`]]);
  } else {
    const side = r.lead_long ? 'LONG' : 'SHORT', ready = r.decision !== 'WAIT';
    const rr = r.rr;
    body = `<div style="margin-bottom:8px">${pill(side + (ready ? ' · READY' : ' · waiting'), ready ? (r.lead_long ? 'up' : 'dn') : 'grey')}</div>` + rows([
      ['Setup', esc(r.setup)], [`LTF MSS (${st.ltf})`, r.mss_ok ? `✓ ${r.mss_ago} bars ago` : 'waiting'],
      ['Entry (now)', `<span class="num">${fp(r.price, st.prec)}</span>`],
      ['Stop loss', `<span class="num dn">${fp(r.sl, st.prec)}</span>`],
      ['TP1', `<span class="num up">${fp(r.tp1, st.prec)}</span>`], ['TP2', `<span class="num up">${fp(r.tp2, st.prec)}</span>`],
      ['R:R (to TP1)', isNum(rr) ? pill('1 : ' + rr.toFixed(2), rr >= st.params.minRR ? 'up' : 'dn') : pill('—', 'grey')]]) +
      `<div style="margin-top:10px;display:flex;gap:6px"><button class="btn" id="btnJournal">Save to journal</button></div>`;
  }
  $('#plan').innerHTML = `<h3>Trade plan ${ltfSeg}</h3>${body}`;
  $('#plan').querySelectorAll('[data-ltf]').forEach(b => b.onclick = () => onLtf(b.dataset.ltf));
  const j = $('#btnJournal'); if (j) j.onclick = onJournal;
}

export function renderChecklist(st, r, onManual) {
  if (!r) { $('#checklist').innerHTML = '<h3>Pre-entry checklist</h3><div class="skel"></div><div class="skel"></div><div class="skel"></div>'; return; }
  const side = r.lead_long ? 'LONG' : 'SHORT';
  const items = r.checks.map(([label, ok]) => {
    const [a, b] = label.split(' · now ');
    return `<div class="check"><div class="ic ${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</div><div class="tx"><b>${esc(a)}</b>${b ? ` <span>· now ${esc(b)}</span>` : ''}</div></div>`;
  }).join('');
  $('#checklist').innerHTML = `<h3>Pre-entry checklist <span class="src">${side} side · ${r.score}/9</span></h3>
    <div class="scorebar"><i style="width:${r.score / 9 * 100}%;background:${r.score >= st.params.minScore ? 'var(--up)' : r.score >= 5 ? 'var(--amber)' : 'var(--dn)'}"></i></div>
    ${items}
    <label class="tick"><input type="checkbox" id="manual" ${st.params.manual ? 'checked' : ''}> Liquidations / footprint confirmed (check Bookmap / CoinGlass)</label>
    <div class="muted" style="margin-top:8px;font-size:11.5px">Take the trade only when every box is ticked.</div>`;
  $('#manual').onchange = e => onManual(e.target.checked);
}

export function renderBias(st, r) {
  if (!r) { $('#bias').innerHTML = '<h3>Bias &amp; location</h3><div class="skel"></div><div class="skel"></div>'; return; }
  const loc = r.loc, pos = loc.pos;
  const zc = loc.zone === 'DISCOUNT' ? 'up' : loc.zone === 'PREMIUM' ? 'dn' : 'grey';
  const ote = loc.in_ote_long || loc.in_ote_short ? ' · OTE' : '';
  $('#bias').innerHTML = '<h3>Bias &amp; location</h3>' + rows([
    ['Daily EMA 12/21', biasPill(r.d_bias)], ['4H EMA 12/21', biasPill(r.h_bias)],
    ['Location (4H range)', pill(`${loc.zone} ${isNum(pos) ? (pos * 100).toFixed(0) + '%' : ''}${ote}`, zc)],
    ['Range high', `<span class="num">${fp(loc.hi, st.prec)}</span>`], ['Equilibrium 0.5', `<span class="num">${fp(loc.eq, st.prec)}</span>`],
    ['Range low', `<span class="num">${fp(loc.lo, st.prec)}</span>`],
    ['OTE long zone', `<span class="num">${fp(loc.ote_long[0], st.prec)} – ${fp(loc.ote_long[1], st.prec)}</span>`],
    ['OTE short zone', `<span class="num">${fp(loc.ote_short[0], st.prec)} – ${fp(loc.ote_short[1], st.prec)}</span>`],
    ['Session (NY time)', pill(r.session, r.session !== 'OFF' ? 'up' : 'grey')],
    ['vs NY midnight open', r.vs_ny_mid === 1 ? pill('ABOVE · bullish day', 'up') : r.vs_ny_mid === -1 ? pill('BELOW · bearish day', 'dn') : '—']]);
}

export function renderLevels(st, r) {
  if (!r) { $('#levels').innerHTML = '<h3>Key levels</h3><div class="skel"></div><div class="skel"></div>'; return; }
  const lv = r.levels;
  let items = Object.entries(LEVEL_NAMES).map(([k, n]) => [n, lv[k], false])
    .concat(Object.entries(r.opens).map(([k, o]) => [OPEN_NAMES[k], o.price, true]))
    .filter(x => isNum(x[1]));
  items.push(['▶ PRICE', r.price, null]);
  items.sort((a, b) => b[1] - a[1]);
  $('#levels').innerHTML = '<h3>Key levels <span class="src">prev day / week · opens</span></h3>' + rows(items.map(([n, v, open]) => {
    if (open === null) return [`<b>${n}</b>`, `<b class="num">${fp(v, st.prec)}</b>`, 'price'];
    const d = (v / r.price - 1) * 100;
    return [open ? `<span style="color:var(--cyan)">${n}</span>` : n, `<span class="num">${fp(v, st.prec)}</span> <span class="num ${tone(d)}" style="display:inline-block;min-width:62px">${fpct(d)}</span>`];
  }));
}

export function renderFlow(st, r, flowMeta) {
  const src = $('#flowSrc');
  if (st.tradfi) {
    src.textContent = '';
    $('#flow').innerHTML = '<div class="muted">Order flow (OI, funding, CVD, liquidations) isn\'t available for this market from free sources. Use bias, levels, opens and structure.</div>';
    $('#notes').innerHTML = '';
    return;
  }
  if (!flowMeta || (!r && !flowMeta.error)) {
    src.textContent = 'Coinalyze · loading…';
    $('#flow').innerHTML = '<div class="tile"><div class="skel"></div><div class="skel"></div></div>'.repeat(6);
    return;
  }
  if (flowMeta.error) {
    src.textContent = 'Coinalyze';
    $('#flow').innerHTML = `<div class="note bear">Order flow unavailable: ${esc(flowMeta.error)}</div>`;
    return;
  }
  src.innerHTML = `Coinalyze · ${flowMeta.perps.length} perp + ${flowMeta.spots.length} spot markets · USD · updated ${ago(Date.now() / 1000 - flowMeta.at)} ago`;
  const side = v => !isNum(v) ? '' : v > 0 ? 'buyers' : 'sellers';
  $('#flow').innerHTML = [
    tile('Open interest', fusd(r.oi_now), isNum(r.oi_24h) ? fpct(r.oi_24h) + ' 24h' : ''),
    tile('OI change 1h / 4h', `<span class="${tone(r.oi_1h)}">${fpct(r.oi_1h)}</span> <span class="muted">/</span> <span class="${tone(r.oi_4h)}">${fpct(r.oi_4h)}</span>`, '', 'sm'),
    tile('Funding (OI-wtd)', isNum(r.funding) ? (r.funding > 0 ? '+' : '') + r.funding.toFixed(4) + '%' : '—', isNum(r.pred_funding) ? `next ${(r.pred_funding > 0 ? '+' : '') + r.pred_funding.toFixed(4)}%` : ''),
    tile('Perp CVD (4h)', fusd(r.perp_cvd_4h), side(r.perp_cvd_4h), tone(r.perp_cvd_4h)),
    tile('Spot CVD (4h)', fusd(r.spot_cvd_4h), side(r.spot_cvd_4h), tone(r.spot_cvd_4h)),
    tile('Liquidations 24h', `<span class="dn">L ${fusd(r.liq_long_24h)}</span>`, `<span class="up">S ${fusd(r.liq_short_24h)}</span>`),
    tile('Long / short ratio', isNum(r.ls_ratio) ? r.ls_ratio.toFixed(2) : '—', flowMeta.snap && flowMeta.snap.lsExchange ? `accounts · ${esc(flowMeta.snap.lsExchange)}` : '>1 = more accounts long'),
  ].join('');
  $('#notes').innerHTML = (r.regime_notes || []).map(([t, c]) => `<div class="note ${c}">${esc(t)}</div>`).join('');
}

export function renderMarkets(st, flowMeta, cbOk) {
  const el = $('#tab-markets');
  const price = st.tradfi
    ? `<b>Price:</b> Yahoo Finance · ${esc(st.ticker)} · refreshes every 30 seconds (no free live feed for futures).`
    : `<b>Price &amp; volume:</b> Binance USDⓈ-M futures · ${esc(st.sym)} · live over websocket (every trade).`;
  let html = `<div class="note neu" style="margin-top:0">${price}</div>`;
  if (!st.tradfi && flowMeta && !flowMeta.error) {
    html += `<div class="note neu"><b>Order flow:</b> Coinalyze, summed across the markets below (USD). To see the same numbers on coinalyze.net, use its aggregated chart with the same exchanges.</div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Exchange</th><th>Market</th><th>Type</th><th>OI (USD)</th><th>Funding %</th></tr></thead><tbody>` +
      flowMeta.perps.map(p => {
        const f = flowMeta.snap && flowMeta.snap.fundingBy ? flowMeta.snap.fundingBy[p.symbol] : null;
        return `<tr><td>${esc(p.exchange)}</td><td>${esc(p.pair)}</td><td>Perp · ${esc(p.margin)}${p.flow ? '' : ' (OI only)'}</td><td class="num">${fusd(p.oi)}</td><td class="num">${isNum(f) ? (f > 0 ? '+' : '') + f.toFixed(4) : '—'}</td></tr>`;
      }).join('') +
      flowMeta.spots.map(p => `<tr><td>${esc(p.exchange)}</td><td>${esc(p.pair)}</td><td>Spot (CVD)</td><td></td><td></td></tr>`).join('') +
      `</tbody></table></div><div class="muted" style="margin-top:6px">Coinalyze calls used in the last minute: ${flowMeta.calls ?? '—'}/40 (data is cached on the server for 1–2 minutes).</div>`;
  }
  if (!st.tradfi) html += `<div class="note neu"><b>Coinbase premium:</b> Coinbase ${esc(st.base)}-USD vs Binance spot ${esc(st.sym)} ${cbOk === false ? '(not listed on Coinbase)' : ''}. <b>Coin info:</b> CoinGecko.</div>`;
  el.innerHTML = html;
}
