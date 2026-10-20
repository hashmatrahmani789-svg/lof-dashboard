// GET /api/store?k=lists | draw:BTC      → { enabled, value }
// PUT /api/store?k=...  body {value}      → saves it (synced between your phone and PC)
import { send, query, readJson } from './_lib.js';
import { storeOn, getKey, setKey } from './_store.js';

const KEY = /^(lists|draw:[A-Z0-9]{1,24}|prefs)$/;

export default async function handler(req, res) {
  const q = query(req), k = String(q.k || '');
  if (!storeOn()) return send(res, 200, { enabled: false, value: null });
  if (!KEY.test(k)) return send(res, 400, { error: 'bad key' });
  try {
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJson(req);
      const raw = JSON.stringify(body.value ?? null);
      if (raw.length > 300000) return send(res, 413, { error: 'too big' });
      await setKey(k, { value: body.value ?? null, at: Date.now() });
      return send(res, 200, { enabled: true, ok: true });
    }
    const v = await getKey(k, null);
    return send(res, 200, { enabled: true, value: v ? v.value : null, at: v ? v.at : 0 });
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
}
