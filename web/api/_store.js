// Small cloud storage (Upstash Redis, free) for watchlists, drawings and price alerts.
// Vercel → Storage → Create → "Upstash for Redis" → connect to this project. That adds KV_REST_API_URL + KV_REST_API_TOKEN.
const url = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const storeOn = () => !!(url() && token());

async function cmd(...args) {
  const r = await fetch(url(), { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (j.error) throw new Error('Storage: ' + j.error);
  return j.result;
}
export async function getKey(key, def = null) {
  if (!storeOn()) return def;
  const v = await cmd('GET', 'lof:' + key);
  return v == null ? def : JSON.parse(v);
}
export async function setKey(key, value) {
  if (!storeOn()) throw new Error('Storage is not connected');
  await cmd('SET', 'lof:' + key, JSON.stringify(value));
}

// Price alerts are one list. Changes are merged by id so the dashboard and the scanner don't overwrite each other.
export async function getAlerts() { return (await getKey('alerts', [])) || []; }
export async function updateAlerts(fn) {
  const cur = await getAlerts();
  const next = fn(cur.map(a => ({ ...a }))) || cur;
  await setKey('alerts', next.slice(-300));
  return next;
}
