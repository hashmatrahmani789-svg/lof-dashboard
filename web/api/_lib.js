// Shared helpers for the server functions (files starting with "_" are not public endpoints).

const MEM = globalThis.__lofMem || (globalThis.__lofMem = new Map());
const INFLIGHT = globalThis.__lofInflight || (globalThis.__lofInflight = new Map());

// In-memory cache shared by requests that hit the same warm server instance.
export async function cached(key, ttlMs, fn) {
  const hit = MEM.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  if (INFLIGHT.has(key)) return INFLIGHT.get(key);
  const p = (async () => {
    try {
      const v = await fn();
      MEM.set(key, { t: Date.now(), v });
      if (MEM.size > 400) MEM.delete(MEM.keys().next().value);
      return v;
    } finally {
      INFLIGHT.delete(key);
    }
  })();
  INFLIGHT.set(key, p);
  return p;
}

export function send(res, status, body, cacheSeconds = 0) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheSeconds > 0 && status === 200) {
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 3}`);
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(body));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function query(req) {
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams.entries());
}

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export async function getJson(url, headers = {}, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctl.signal });
    if (!r.ok) {
      const e = new Error(`HTTP ${r.status} from ${new URL(url).host}`);
      e.status = r.status;
      e.retryAfter = Number(r.headers.get('retry-after')) || 0;
      throw e;
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Coinalyze ─────────────────────────────────────────────
// Free plan: 40 calls per minute, and every symbol in a request counts as one call.
const CZ = 'https://api.coinalyze.net/v1/';
const CALLS = globalThis.__lofCalls || (globalThis.__lofCalls = []);

export function callsLastMinute() {
  const now = Date.now();
  while (CALLS.length && now - CALLS[0][0] > 60000) CALLS.shift();
  return CALLS.reduce((a, c) => a + c[1], 0);
}

export async function cz(endpoint, params = {}) {
  const key = process.env.COINALYZE_API_KEY;
  if (!key) throw Object.assign(new Error('COINALYZE_API_KEY is not set in Vercel → Settings → Environment Variables.'), { status: 500 });
  const n = params.symbols ? String(params.symbols).split(',').length : 1;
  // stay under the limit on this instance
  for (let i = 0; i < 30 && callsLastMinute() + n > 39; i++) await sleep(1000);
  const qs = new URLSearchParams(params).toString();
  for (let attempt = 0; attempt < 3; attempt++) {
    CALLS.push([Date.now(), n]);
    try {
      return await getJson(CZ + endpoint + (qs ? '?' + qs : ''), { api_key: key }, 20000);
    } catch (e) {
      if (e.status === 401) throw Object.assign(new Error('Coinalyze rejected the API key.'), { status: 500 });
      if (e.status === 429 && attempt < 2) { await sleep(Math.min(Math.max(e.retryAfter || 5, 1), 20) * 1000); continue; }
      throw e;
    }
  }
}
