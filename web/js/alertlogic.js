// Price-alert logic shared by the dashboard (live prices) and the server scanner (1-minute candles).
// alert: { kind: 'price' | 'line', price, line: {t1, p1, t2, p2}, cond: 'cross' | 'up' | 'down', side: 'above' | 'below', lastT }

export function levelAt(a, t) {
  if (a.kind === 'line' && a.line) {
    const { t1, p1, t2, p2 } = a.line;
    return t2 === t1 ? p1 : p1 + (p2 - p1) * (t - t1) / (t2 - t1);
  }
  return a.price;
}

export const condText = c => c === 'up' ? 'crossing up' : c === 'down' ? 'crossing down' : 'crossing';

// Walk candles {t, h, l, c} in time order. Returns the first trigger or null. Updates a.side and a.lastT.
export function runAlert(a, bars) {
  for (const b of bars) {
    if (a.lastT && b.t < a.lastT) continue;
    const lv = levelAt(a, b.t);
    const upHit = b.h >= lv, dnHit = b.l <= lv;
    let dir = null;
    if ((a.cond === 'up' || a.cond === 'cross') && a.side === 'below' && upHit) dir = 'up';
    else if ((a.cond === 'down' || a.cond === 'cross') && a.side === 'above' && dnHit) dir = 'down';
    a.lastT = b.t;
    if (dir) { a.side = dir === 'up' ? 'above' : 'below'; return { t: b.t, level: lv, dir, price: dir === 'up' ? Math.max(lv, b.c) : Math.min(lv, b.c) }; }
    a.side = b.c >= lv ? 'above' : 'below';
  }
  return null;
}
