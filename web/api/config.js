// GET /api/config → which optional features are set up (no secrets returned).
import { send, callsLastMinute } from './_lib.js';
import { storeOn } from './_store.js';

export default function handler(req, res) {
  send(res, 200, {
    coinalyze: !!process.env.COINALYZE_API_KEY,
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    notion: !!(process.env.NOTION_TOKEN && process.env.NOTION_DB_ID),
    storage: storeOn(),
    scanner: !!process.env.SCAN_KEY,
    calls: callsLastMinute(),
  });
}
