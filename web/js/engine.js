// LOF analysis engine (runs in the browser).
// Bias, levels, volume profiles, opens, Asia range, structure (MSS / sweeps), order-flow regime, setups, trade plan.
// Bars: {t (UTC seconds, bar open), o, h, l, c, v}

export const isNum = x => typeof x === 'number' && Number.isFinite(x);
const last = a => a[a.length - 1];
const DAY = 86400;

// ── time helpers (New York) ─────────────────────────────────
const fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
export function nyParts(ts) {
  const p = {};
  for (const x of fmtNY.formatToParts(new Date(ts * 1000))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, wd: p.weekday };
}
function nyOffset(ts) {               // NY wall clock minus UTC, in seconds
  const p = nyParts(ts);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) / 1000 - Math.floor(ts / 60) * 60;
}
export function nyToUtc(y, m, d, h, mi) {
  const g = Date.UTC(y, m - 1, d, h, mi) / 1000;
  const t1 = g - nyOffset(g);
  return g - nyOffset(t1);
}
function prevDate(y, m, d) { const x = new Date(Date.UTC(y, m - 1, d - 1)); return [x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()]; }
export function lastAt(now, h, mi) {   // most recent NY wall-clock h:mi at or before now (UTC seconds)
  const p = nyParts(now);
  let t = nyToUtc(p.y, p.m, p.d, h, mi);
  if (t > now) { const [y, m, d] = prevDate(p.y, p.m, p.d); t = nyToUtc(y, m, d, h, mi); }
  return t;
}
function backOneNyDay(t) {             // same NY wall-clock time, one day earlier
  const p = nyParts(t); const [y, m, d] = prevDate(p.y, p.m, p.d); return nyToUtc(y, m, d, p.h, p.mi);
}
export const nyMinutes = ts => { const p = nyParts(ts); return p.h * 60 + p.mi; };
const dayStart = t => Math.floor(t / DAY) * DAY;
const weekday = t => (Math.floor(t / DAY) + 3) % 7;          // Monday = 0 (UTC)

// ── basics ──────────────────────────────────────────────────
export function ema(vals, n) {
  const k = 2 / (n + 1), out = []; let e;
  vals.forEach((v, i) => { e = i === 0 ? v : v * k + e * (1 - k); out.push(e); });
  return out;
}
export function biasFrom(closes, price, fast = 12, slow = 21) {
  if (!closes || closes.length < slow) return [NaN, NaN, 0];
  const e1 = last(ema(closes, fast)), e2 = last(ema(closes, slow));
  return [e1, e2, price > e1 && e1 > e2 ? 1 : price < e1 && e1 < e2 ? -1 : 0];
}
export function atr(bars, n = 14) {
  if (!bars || bars.length < n + 1) return NaN;
  let s = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].c;
    s += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return s / n;
}

export function profileRows(bars, bins = 40, va = 0.70) {
  if (!bars || !bars.length) return null;
  let hi = -Infinity, lo = Infinity;
  bars.forEach(b => { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); });
  if (!(hi > lo)) return null;
  const step = (hi - lo) / bins, up = new Array(bins).fill(0), dn = new Array(bins).fill(0);
  const clamp = x => Math.min(bins - 1, Math.max(0, x));
  bars.forEach(b => {
    const v = Math.max(0, b.v || 0);
    const b0 = clamp(Math.floor((b.l - lo) / step)), b1 = clamp(Math.floor((b.h - lo) / step));
    const arr = b.c >= b.o ? up : dn, sh = v / (b1 - b0 + 1);
    for (let k = b0; k <= b1; k++) arr[k] += sh;
  });
  const tot = up.map((x, i) => x + dn[i]);
  const total = tot.reduce((a, x) => a + x, 0);
  if (total <= 0) return null;
  let pi = 0; tot.forEach((x, i) => { if (x > tot[pi]) pi = i; });
  let acc = tot[pi], u = pi, d = pi;
  while (acc < total * va && (u < bins - 1 || d > 0)) {
    const vu = u < bins - 1 ? tot[u + 1] : -1, vd = d > 0 ? tot[d - 1] : -1;
    if (vu >= vd) { u++; acc += vu; } else { d--; acc += vd; }
  }
  return { lo, step, up, dn, poc: lo + step * (pi + 0.5), vah: lo + step * (u + 1), val: lo + step * d };
}
const vpOf = bars => { const p = profileRows(bars); return p ? [p.poc, p.vah, p.val] : [NaN, NaN, NaN]; };

export function sessionProfiles(m30, now) {
  const out = {};
  if (!m30 || !m30.length) return out;
  const day0 = dayStart(now), week0 = day0 - weekday(day0) * DAY;
  let pday = day0 - DAY;
  for (let i = 0; i < 7; i++) {
    if (m30.some(b => b.t >= pday && b.t < pday + DAY)) break;
    pday -= DAY;
  }
  [['day', pday, pday + DAY], ['week', week0 - 7 * DAY, week0]].forEach(([k, s, e]) => {
    const p = profileRows(m30.filter(b => b.t >= s && b.t < e));
    if (p) out[k] = Object.assign(p, { start: s, end: e });
  });
  return out;
}

export function computeOpens(m30, daily, now) {
  const out = {};
  if (m30 && m30.length) {
    const idx = new Map(m30.map(b => [b.t, b.o]));
    [['d_open', dayStart(now)], ['ny_mid', lastAt(now, 0, 0)], ['ldn_open', lastAt(now, 3, 0)], ['ny_open', lastAt(now, 8, 30)]]
      .forEach(([k, ts]) => {
        for (let i = 0; i < 7; i++) {
          if (idx.has(ts)) { out[k] = { time: ts, price: idx.get(ts) }; break; }
          ts = k === 'd_open' ? ts - DAY : backOneNyDay(ts);
        }
      });
  }
  if (daily && daily.length) {
    const day0 = dayStart(now), w0 = day0 - weekday(day0) * DAY;
    const d = new Date(now * 1000), m0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    const first = from => daily.find(b => dayStart(b.t) >= from);
    const w = first(w0) || first(w0 - 7 * DAY), m = first(m0);
    if (w) out.w_open = { time: w.t, price: w.o };
    if (m) out.m_open = { time: m.t, price: m.o };
  }
  return out;
}

export function asiaRange(m30, now) {
  if (!m30 || !m30.length) return null;
  let start = lastAt(now, 20, 0), w = [];
  for (let i = 0; i < 7; i++) {
    const end = start + 4 * 3600;
    w = m30.filter(b => b.t >= start && b.t < end);
    if (w.length) break;
    start = backOneNyDay(start);
  }
  if (!w.length) return null;
  const end = start + 4 * 3600;
  return { start, end, hi: Math.max(...w.map(b => b.h)), lo: Math.min(...w.map(b => b.l)), live: now < end };
}

// Where each level starts (UTC seconds), so lines can be drawn from their origin to the right.
export function levelTimes(daily, m30, now) {
  const today = dayStart(now), weekStart = today - weekday(today) * DAY, pwStart = weekStart - 7 * DAY;
  const out = {};
  const ext = (bars, key, hiKey) => {
    if (!bars.length) return;
    let bh = bars[0], bl = bars[0];
    bars.forEach(b => { if (b.h > bh.h) bh = b; if (b.l < bl.l) bl = b; });
    out[hiKey] = bh.t; out[key] = bl.t;
  };
  const md = (m30 || []).filter(b => dayStart(b.t) < today);
  let pday = today - DAY;
  if (md.length && !md.some(b => dayStart(b.t) === pday)) pday = dayStart(md[md.length - 1].t);
  const dayBars = (m30 || []).filter(b => dayStart(b.t) === pday);
  const weekBars = (m30 || []).filter(b => dayStart(b.t) >= pwStart && dayStart(b.t) < weekStart);
  if (dayBars.length) ext(dayBars, 'pdl', 'pdh');
  else if (daily && daily.length) { const d = daily.filter(b => dayStart(b.t) < today).pop(); if (d) { out.pdh = d.t; out.pdl = d.t; } }
  if (weekBars.length) ext(weekBars, 'pwl', 'pwh');
  else out.pwh = out.pwl = pwStart;
  ['pd_poc', 'pd_vah', 'pd_val'].forEach(k => { out[k] = dayBars.length ? dayBars[0].t : pday; });
  ['pw_poc', 'pw_vah', 'pw_val'].forEach(k => { out[k] = weekBars.length ? weekBars[0].t : pwStart; });
  return out;
}

export function computeLevels(daily, m30, now) {
  const today = dayStart(now), weekStart = today - weekday(today) * DAY, pwStart = weekStart - 7 * DAY;
  let prevDay = today - DAY;
  const lv = { pdh: NaN, pdl: NaN, pwh: NaN, pwl: NaN, pd_poc: NaN, pd_vah: NaN, pd_val: NaN, pw_poc: NaN, pw_vah: NaN, pw_val: NaN };
  if (daily && daily.length) {
    const past = daily.filter(b => dayStart(b.t) < today);
    if (past.length && !past.some(b => dayStart(b.t) === prevDay)) prevDay = dayStart(last(past).t);
    const pr = daily.find(b => dayStart(b.t) === prevDay);
    if (pr) { lv.pdh = pr.h; lv.pdl = pr.l; }
    const pw = daily.filter(b => dayStart(b.t) >= pwStart && dayStart(b.t) < weekStart);
    if (pw.length) { lv.pwh = Math.max(...pw.map(b => b.h)); lv.pwl = Math.min(...pw.map(b => b.l)); }
  }
  if (m30 && m30.length) {
    const md = m30.filter(b => dayStart(b.t) < today);
    const pday = md.some(b => dayStart(b.t) === prevDay) ? prevDay : (md.length ? dayStart(last(md).t) : prevDay);
    [lv.pd_poc, lv.pd_vah, lv.pd_val] = vpOf(m30.filter(b => dayStart(b.t) === pday));
    [lv.pw_poc, lv.pw_vah, lv.pw_val] = vpOf(m30.filter(b => dayStart(b.t) >= pwStart && dayStart(b.t) < weekStart));
  }
  return lv;
}

export function location(h4, price, lookback = 30) {
  if (!h4 || !h4.length) return { hi: NaN, lo: NaN, eq: NaN, pos: NaN, zone: '—', in_ote_long: false, in_ote_short: false, ote_long: [NaN, NaN], ote_short: [NaN, NaN] };
  const w = h4.slice(-lookback);
  const hi = Math.max(...w.map(b => b.h), price), lo = Math.min(...w.map(b => b.l), price), rng = hi - lo;
  const pos = rng > 0 ? (price - lo) / rng : NaN;
  const zone = !isNum(pos) ? '—' : pos >= 0.48 && pos <= 0.52 ? 'EQUILIBRIUM' : pos > 0.5 ? 'PREMIUM' : 'DISCOUNT';
  return { hi, lo, eq: lo + rng / 2, pos, zone,
    in_ote_long: isNum(pos) && pos >= 0.21 && pos <= 0.38, in_ote_short: isNum(pos) && pos >= 0.62 && pos <= 0.79,
    ote_long: [hi - 0.79 * rng, hi - 0.62 * rng], ote_short: [lo + 0.62 * rng, lo + 0.79 * rng] };
}

export function structure(bars, piv, valid, bullLv, bearLv) {
  const n = bars.length;
  let lastPh = NaN, lastPl = NaN, state = 0, mssBull = null, mssBear = null, swBull = null, swBear = null, swBullPx = NaN, swBearPx = NaN;
  for (let i = 0; i < n; i++) {
    const j = i - piv;
    if (j >= piv) {
      let mx = -Infinity, mn = Infinity;
      for (let k = j - piv; k <= j + piv; k++) { mx = Math.max(mx, bars[k].h); mn = Math.min(mn, bars[k].l); }
      if (bars[j].h === mx) lastPh = bars[j].h;
      if (bars[j].l === mn) lastPl = bars[j].l;
    }
    if (i > 0) {
      const c = bars[i].c, pc = bars[i - 1].c;
      if (isNum(lastPh) && c > lastPh && pc <= lastPh) { if (state === -1) mssBull = i; state = 1; }
      if (isNum(lastPl) && c < lastPl && pc >= lastPl) { if (state === 1) mssBear = i; state = -1; }
    }
    if (i >= n - 1 - valid) {
      const b = bars[i];
      if (bullLv.some(x => isNum(x) && b.l < x && x < b.c)) { swBull = i; swBullPx = b.l; }
      if (bearLv.some(x => isNum(x) && b.h > x && x > b.c)) { swBear = i; swBearPx = b.h; }
    }
  }
  const recent = k => k != null && n - 1 - k <= valid;
  return { last_ph: lastPh, last_pl: lastPl, mss_bull: recent(mssBull), mss_bear: recent(mssBear),
    mss_bull_ago: mssBull == null ? null : n - 1 - mssBull, mss_bear_ago: mssBear == null ? null : n - 1 - mssBear,
    sw_bull: recent(swBull), sw_bear: recent(swBear), sw_bull_px: swBullPx, sw_bear_px: swBearPx };
}

function pctChangeOver(series, hours, now) {     // series: [{t, v}]
  if (!series || !series.length) return NaN;
  const cut = now - hours * 3600;
  let past = null;
  for (const p of series) { if (p.t <= cut) past = p; else break; }
  if (!past || !past.v) return NaN;
  return (last(series).v / past.v - 1) * 100;
}

export function sessionNow(now) {
  const m = nyMinutes(now);
  return m >= 120 && m < 300 ? 'LONDON' : m >= 420 && m < 600 ? 'NEW YORK' : 'OFF';
}

function targets(levels, price, minDist, isLong) {
  const c = levels.filter(x => isNum(x) && (isLong ? x > price + minDist : x < price - minDist)).sort((a, b) => a - b);
  let f = [];
  c.forEach(x => { if (!f.length || Math.abs(x - last(f)) > minDist) f.push(x); });
  if (!isLong) f = f.reverse();
  return [f.length ? f[0] : NaN, f.length > 1 ? f[1] : NaN];
}

export function regime(px4, oi4, perp4, spot4, funding, oi24, hasSpot, vol4 = NaN, thPx = 0.3) {
  const thOi = 0.5;
  const imb = isNum(vol4) && vol4 > 0 && isNum(perp4) ? Math.abs(perp4) / vol4 : 0;
  const strong = imb >= 0.08;
  const up = px4 > thPx, dn = px4 < -thPx, oiUp = oi4 > thOi, oiDn = oi4 < -thOi;
  let main;
  if (!isNum(px4) || !isNum(oi4)) main = ['NO DATA', 'Not enough data for a regime read.', 'neu'];
  else if (up && oiUp) main = ['NEW LONGS', 'Price ↑ + OI ↑: fresh longs entering, strong up move.', 'bull'];
  else if (up && oiDn) main = ['SHORT SQUEEZE', 'Price ↑ + OI ↓: shorts closing. Move can fade once covering ends.', 'bull'];
  else if (dn && oiUp) main = ['NEW SHORTS', 'Price ↓ + OI ↑: fresh shorts entering, strong down move.', 'bear'];
  else if (dn && oiDn) main = ['LONG FLUSH', 'Price ↓ + OI ↓: longs liquidated/closing. Often exhausts near a sweep low.', 'bear'];
  else if (!up && !dn && strong && perp4 < 0) main = ['ABSORPTION (BULLISH)', `Price flat while perp sellers dominate (${(imb * 100).toFixed(0)}% of 4h volume): sellers being absorbed.`, 'bull'];
  else if (!up && !dn && strong && perp4 > 0) main = ['ABSORPTION (BEARISH)', `Price flat while perp buyers dominate (${(imb * 100).toFixed(0)}% of 4h volume): buyers being absorbed.`, 'bear'];
  else main = [up || dn ? 'LOW-LEVERAGE MOVE' : 'RANGE / NO EDGE', 'OI flat: no strong positioning signal.', 'neu'];
  const notes = [];
  if (hasSpot && isNum(spot4) && isNum(perp4)) {
    if (spot4 > 0 && perp4 < 0) notes.push(['Spot buying vs perp selling: spot-led, healthier.', 'bull']);
    else if (perp4 > 0 && spot4 < 0) notes.push(['Perp buying vs spot selling: leverage-led, fragile.', 'bear']);
  }
  if (isNum(funding) && isNum(oi24)) {
    if (funding > 0.03 && oi24 > 5) notes.push(['CROWDED LONGS: high funding + rising OI → long-squeeze risk.', 'bear']);
    else if (funding < -0.01 && oi24 > 5) notes.push(['CROWDED SHORTS: negative funding + rising OI → short-squeeze risk.', 'bull']);
  }
  if (isNum(funding) && Math.abs(funding) >= 0.05) notes.push([`Funding extreme (${funding > 0 ? '+' : ''}${funding.toFixed(4)}%).`, funding > 0 ? 'bear' : 'bull']);
  return [main, notes];
}

// ── full analysis ───────────────────────────────────────────
// inp: {ltf, daily, h4, m30, flow?, snap?, tradfi, params:{piv, valid, minRR, minScore, manual}, now?}
// flow: {perp:[[t, delta, vol]], spot:[[t, delta, vol]], oi:[[t,o,h,l,c]], liq:[[t, long, short]]}
export function analyze(inp) {
  const { ltf, daily, h4, m30, flow, snap, tradfi } = inp;
  const P = Object.assign({ piv: 3, valid: 20, minRR: 2, minScore: 7, manual: false }, inp.params || {});
  if (!ltf || !ltf.length) throw new Error('No price data for this market.');
  const now = inp.now || Math.floor(Date.now() / 1000);
  const price = last(ltf).c;

  const [dE1, dE2, dB] = biasFrom(daily && daily.map(b => b.c), price);
  const [hE1, hE2, hB] = biasFrom(h4 && h4.map(b => b.c), price);
  const lv = computeLevels(daily, m30, now);
  const loc = location(h4, price);
  const s = structure(ltf, P.piv, P.valid, [lv.pdl, lv.pwl, lv.pd_val, lv.pw_val], [lv.pdh, lv.pwh, lv.pd_vah, lv.pw_vah]);

  // flow
  const cut = now - 4 * 3600;
  const sumAfter = (rows, col) => rows && rows.length ? rows.filter(r => r[0] > cut).reduce((a, r) => a + r[col], 0) : NaN;
  const perp4 = flow ? sumAfter(flow.perp, 1) : NaN;
  const spot4 = flow && flow.spot && flow.spot.length ? sumAfter(flow.spot, 1) : NaN;
  const vol4 = flow ? sumAfter(flow.perp, 2) : NaN;
  const px4 = pctChangeOver(ltf.map(b => ({ t: b.t, v: b.c })), 4, now);
  const oiSer = flow && flow.oi ? flow.oi.map(r => ({ t: r[0], v: r[4] })) : [];
  const oiNow = oiSer.length ? last(oiSer).v : NaN;
  const [oi1, oi4, oi24] = [1, 4, 24].map(h => pctChangeOver(oiSer, h, now));
  let liqL = 0, liqS = 0;
  (flow && flow.liq || []).forEach(r => { if (r[0] > now - 24 * 3600) { liqL += r[1]; liqS += r[2]; } });
  const funding = snap && isNum(snap.funding) ? snap.funding : NaN;
  const predFunding = snap && isNum(snap.pred) ? snap.pred : NaN;

  let thPx = 0.3;
  if (h4 && h4.length > 15) { const a = atr(h4) / price * 100; if (isNum(a)) thPx = Math.max(0.15, 0.35 * a); }
  let [regMain, regNotes] = regime(px4, oi4, perp4, spot4, funding, oi24, !!(flow && flow.spot && flow.spot.length), vol4, thPx);
  if (tradfi) { regMain = ['PRICE ONLY', 'No OI / CVD / funding data for this market. Use bias, levels and structure.', 'neu']; regNotes = []; }
  else if (!flow) { regMain = ['LOADING ORDER FLOW', 'Coinalyze data is loading…', 'neu']; regNotes = []; }

  // setups
  const inDisc = isNum(loc.pos) && loc.pos < 0.5, inPrem = isNum(loc.pos) && loc.pos > 0.5;
  const aLong = s.sw_bull && inDisc && !(dB === -1 && hB === -1);
  const bLong = hB === 1 && dB !== -1 && inDisc;
  const aShort = s.sw_bear && inPrem && !(dB === 1 && hB === 1);
  const bShort = hB === -1 && dB !== 1 && inPrem;
  const name = (a, b) => a && b ? 'A+ SWEEP + PULLBACK' : a ? 'A SWEEP' : b ? 'B PULLBACK' : 'NONE';
  const setL = name(aLong, bLong), setS = name(aShort, bShort);

  // SL / TP
  let a = atr(ltf); if (!isNum(a)) a = price * 0.003;
  const minDist = a * 0.25, win = P.piv * 4 + 1, tail = ltf.slice(-win);
  let baseL = s.sw_bull ? s.sw_bull_px : s.last_pl;
  if (!isNum(baseL) || baseL >= price) baseL = Math.min(...tail.map(b => b.l));
  let baseS = s.sw_bear ? s.sw_bear_px : s.last_ph;
  if (!isNum(baseS) || baseS <= price) baseS = Math.max(...tail.map(b => b.h));
  const slL = baseL - a * 0.2, slS = baseS + a * 0.2;
  const tgt = Object.values(lv).concat([loc.hi, loc.lo, loc.eq]);
  const [tp1L, tp2L] = targets(tgt, price, minDist, true);
  const [tp1S, tp2S] = targets(tgt, price, minDist, false);
  const rrL = price > slL && isNum(tp1L) ? (tp1L - price) / (price - slL) : NaN;
  const rrS = slS > price && isNum(tp1S) ? (price - tp1S) / (slS - price) : NaN;

  const session = sessionNow(now), inSes = session !== 'OFF';
  const cvdUp = isNum(perp4) && perp4 > 0, cvdDn = isNum(perp4) && perp4 < 0;
  const bt = v => v === 1 ? 'BULL' : v === -1 ? 'BEAR' : 'MIXED';
  const nowT = x => ' · now ' + x;
  const rrt = v => isNum(v) ? '1:' + v.toFixed(2) : '—';
  const cvdT = !isNum(perp4) ? 'N/A' : perp4 > 0 ? 'rising' : 'falling';
  const checksL = [['Daily EMA bullish' + nowT(bt(dB)), dB === 1], ['4H EMA bullish' + nowT(bt(hB)), hB === 1],
    ['In discount' + nowT(loc.zone), inDisc], ['Setup A/B present' + nowT(setL), setL !== 'NONE'],
    ['LTF MSS bullish' + nowT(s.mss_bull ? 'yes' : 'not yet'), s.mss_bull], ['Perp CVD rising (4h)' + nowT(cvdT), cvdUp],
    ['In London/NY session' + nowT(session), inSes], [`R:R ≥ ${P.minRR}` + nowT(rrt(rrL)), isNum(rrL) && rrL >= P.minRR],
    ['Liqs / footprint confirm' + nowT(P.manual ? 'ticked' : 'tick the box'), P.manual]];
  const checksS = [['Daily EMA bearish' + nowT(bt(dB)), dB === -1], ['4H EMA bearish' + nowT(bt(hB)), hB === -1],
    ['In premium' + nowT(loc.zone), inPrem], ['Setup A/B present' + nowT(setS), setS !== 'NONE'],
    ['LTF MSS bearish' + nowT(s.mss_bear ? 'yes' : 'not yet'), s.mss_bear], ['Perp CVD falling (4h)' + nowT(cvdT), cvdDn],
    ['In London/NY session' + nowT(session), inSes], [`R:R ≥ ${P.minRR}` + nowT(rrt(rrS)), isNum(rrS) && rrS >= P.minRR],
    ['Liqs / footprint confirm' + nowT(P.manual ? 'ticked' : 'tick the box'), P.manual]];
  const scoreL = checksL.filter(c => c[1]).length, scoreS = checksS.filter(c => c[1]).length;
  const longOk = setL !== 'NONE' && s.mss_bull && isNum(rrL) && rrL >= P.minRR && scoreL >= P.minScore;
  const shortOk = setS !== 'NONE' && s.mss_bear && isNum(rrS) && rrS >= P.minRR && scoreS >= P.minScore;
  const decision = longOk && (!shortOk || scoreL >= scoreS) ? 'LONG' : shortOk ? 'SHORT' : 'WAIT';
  let lead;
  if (decision !== 'WAIT') lead = decision === 'LONG';
  else if (setL !== 'NONE' && setS === 'NONE') lead = true;
  else if (setS !== 'NONE' && setL === 'NONE') lead = false;
  else lead = scoreL >= scoreS;

  const opens = computeOpens(m30, daily, now);
  const nyMid = opens.ny_mid ? opens.ny_mid.price : NaN;
  return {
    now, price, session, opens, asia: asiaRange(m30, now), profiles: sessionProfiles(m30, now),
    vs_ny_mid: !isNum(nyMid) ? 0 : price > nyMid ? 1 : -1,
    set_long: setL, set_short: setS, score_long: scoreL, score_short: scoreS, checks_long: checksL, checks_short: checksS,
    d_bias: dB, h_bias: hB, d_ema: [dE1, dE2], h_ema: [hE1, hE2], levels: lv, level_t: levelTimes(daily, m30, now), loc, struct: s,
    perp_cvd_4h: perp4, spot_cvd_4h: spot4, px_4h: px4, oi_now: oiNow, oi_1h: oi1, oi_4h: oi4, oi_24h: oi24,
    funding, pred_funding: predFunding, liq_long_24h: liqL, liq_short_24h: liqS,
    ls_ratio: snap && isNum(snap.ls) ? snap.ls : NaN,
    regime: regMain, regime_notes: regNotes, lead_long: lead, decision,
    setup: lead ? setL : setS, mss_ok: lead ? s.mss_bull : s.mss_bear, mss_ago: lead ? s.mss_bull_ago : s.mss_bear_ago,
    sl: lead ? slL : slS, tp1: lead ? tp1L : tp1S, tp2: lead ? tp2L : tp2S, rr: lead ? rrL : rrS,
    score: lead ? scoreL : scoreS, checks: lead ? checksL : checksS,
    sides: { long: { sl: slL, tp1: tp1L, tp2: tp2L, rr: rrL }, short: { sl: slS, tp1: tp1S, tp2: tp2S, rr: rrS } },
  };
}

export const LEVEL_NAMES = { pdh: 'PDH', pdl: 'PDL', pwh: 'PWH', pwl: 'PWL', pd_poc: 'D POC', pw_poc: 'W POC',
  pd_vah: 'D VAH', pd_val: 'D VAL', pw_vah: 'W VAH', pw_val: 'W VAL' };
export const OPEN_NAMES = { d_open: 'Daily open', ny_mid: 'NY midnight', ldn_open: 'London open', ny_open: 'NY open',
  w_open: 'Weekly open', m_open: 'Monthly open' };

export function nearestLevel(r) {
  const all = Object.entries(r.levels).map(([k, v]) => [LEVEL_NAMES[k], v])
    .concat(Object.entries(r.opens).map(([k, o]) => [OPEN_NAMES[k], o.price]))
    .filter(x => isNum(x[1]));
  if (!all.length) return null;
  all.sort((a, b) => Math.abs(a[1] - r.price) - Math.abs(b[1] - r.price));
  return { name: all[0][0], price: all[0][1], dist: (all[0][1] / r.price - 1) * 100 };
}

// Daily candles → simple performance numbers (for gold / indices)
export function perfFromDaily(daily, price) {
  if (!daily || !daily.length) return {};
  const c = daily.map(b => b.c), n = c.length;
  const chg = k => n > k ? (price / c[n - 1 - k] - 1) * 100 : NaN;
  const yr = daily.slice(-252);
  return { chg_24h: chg(1), chg_7d: chg(5), chg_30d: chg(21), hi_52w: Math.max(...yr.map(b => b.h)), lo_52w: Math.min(...yr.map(b => b.l)) };
}
