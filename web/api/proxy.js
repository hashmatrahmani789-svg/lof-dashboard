// Read-only data proxy with caching: Yahoo Finance, CoinGecko, Fear & Greed, Forex Factory, Coinbase.
// Only the sources below are allowed.
import { cached, send, query, getJson } from './_lib.js';

const YF_INTERVALS = new Set(['5m', '15m', '30m', '60m', '1d']);
const YF_RANGES = new Set(['1d', '5d', '7d', '10d', '1mo', '20d', '60d', '3mo', '6mo', '1y', '2y']);
const CG_PATH = /^(search|global|coins\/markets|coins\/[a-z0-9-]+)$/;
const CG_KEYS = new Set(['query', 'vs_currency', 'ids', 'sparkline', 'localization', 'tickers', 'community_data', 'developer_data', 'price_change_percentage']);
const CB_GRAN = new Set(['60', '300', '900', '3600', '21600', '86400']);

async function yahoo(t, i, r) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=${i}&range=${r}&includePrePost=true`;
  let j;
  try { j = await getJson(url); } catch (e) { j = await getJson(url.replace('query1', 'query2')); }
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('No data from Yahoo for ' + t);
  const ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {};
  const bars = [];
  ts.forEach((tt, k) => {
    const o = q.open?.[k], h = q.high?.[k], l = q.low?.[k], c = q.close?.[k];
    if ([o, h, l, c].some(v => v == null)) return;
    bars.push([tt, o, h, l, c, q.volume?.[k] || 0]);
  });
  return { t, bars, prev: res.meta?.chartPreviousClose ?? null, name: res.meta?.shortName || '' };
}

export default async function handler(req, res) {
  const q = query(req);
  try {
    switch (q.src) {
      case 'yahoo': {
        const t = String(q.t || '');
        if (!/^[A-Z0-9^=.\-]{1,15}$/i.test(t) || !YF_INTERVALS.has(q.i) || !YF_RANGES.has(q.r)) return send(res, 400, { error: 'bad params' });
        const ttl = q.i === '1d' ? 600 : 60;
        return send(res, 200, await cached(`yf:${t}:${q.i}:${q.r}`, ttl * 1000, () => yahoo(t, q.i, q.r)), ttl);
      }
      case 'cg': {
        const p = String(q.path || '');
        if (!CG_PATH.test(p)) return send(res, 400, { error: 'bad path' });
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(q)) if (CG_KEYS.has(k)) params.set(k, v);
        const key = process.env.COINGECKO_API_KEY;
        const url = `https://api.coingecko.com/api/v3/${p}${params.toString() ? '?' + params : ''}`;
        const data = await cached('cg:' + url, 300e3, () => getJson(url, key ? { 'x-cg-demo-api-key': key } : {}));
        return send(res, 200, data, 300);
      }
      case 'fng':
        return send(res, 200, await cached('fng', 600e3, () => getJson('https://api.alternative.me/fng/?limit=30')), 600);
      case 'fnghist':
        return send(res, 200, await cached('fnghist', 3600e3, () => getJson('https://api.alternative.me/fng/?limit=0')), 3600);
      case 'cnn':
        return send(res, 200, await cached('cnn', 600e3, () => getJson('https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
          { Referer: 'https://edition.cnn.com/' })), 600);
      case 'ff':
        return send(res, 200, await cached('ff', 1800e3, () => getJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json')), 1800);
      case 'cb': {
        const p = String(q.p || '').toUpperCase();
        if (!/^[A-Z0-9]{1,12}-USD$/.test(p) || !CB_GRAN.has(String(q.g))) return send(res, 400, { error: 'bad params' });
        const data = await cached(`cb:${p}:${q.g}`, 30e3, () => getJson(`https://api.exchange.coinbase.com/products/${p}/candles?granularity=${q.g}`));
        return send(res, 200, data, 30);
      }
      default:
        return send(res, 400, { error: 'unknown source' });
    }
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
}
