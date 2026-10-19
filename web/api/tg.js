// POST /api/tg  {text}  → sends a Telegram message to your chat.
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel environment variables.
import { send, readJson } from './_lib.js';

export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return send(res, 501, { error: 'Telegram is not set up (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const body = await readJson(req);
  const text = String(body.text || '').slice(0, 3500);
  if (!text) return send(res, 400, { error: 'text is required' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const j = await r.json();
    return send(res, j.ok ? 200 : 502, j.ok ? { ok: true } : { error: j.description || 'Telegram error' });
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
}
