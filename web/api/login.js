// POST /api/login  (form field: password) → sets the login cookie for 90 days.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readJson } from './_lib.js';

export default async function handler(req, res) {
  const pw = process.env.APP_PASSWORD || '';
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  let entered = '';
  if (typeof req.body === 'string') entered = new URLSearchParams(req.body).get('password') || '';
  else if (req.body && typeof req.body === 'object') entered = req.body.password || '';
  else {
    const raw = await readJson(req).catch(() => ({}));
    entered = raw.password || '';
  }
  const a = Buffer.from(entered), b = Buffer.from(pw);
  const ok = pw && a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.statusCode = 303;
    res.setHeader('Location', '/login.html?wrong=1');
    return res.end();
  }
  const token = createHash('sha256').update(pw + ':lof-dashboard').digest('hex');
  res.setHeader('Set-Cookie', `lof_auth=${token}; Path=/; Max-Age=${90 * 86400}; HttpOnly; Secure; SameSite=Lax`);
  res.statusCode = 303;
  res.setHeader('Location', '/');
  res.end();
}
