// POST /api/journal  {coin, side, setup, entry, sl, tp1, tp2, rr, score, tf, notes, url}
// Adds a page to your Notion trade log. Needs NOTION_TOKEN and NOTION_DB_ID.
// Fields are matched to your database columns by name (Coin/Asset, Side/Direction, Entry, SL/Stop, TP, R:R, Score, Setup, Date…).
import { send, readJson } from './_lib.js';

const NOTION = 'https://api.notion.com/v1/';
const H = token => ({ Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' });

const MATCH = [
  ['coin', /^(coin|asset|symbol|ticker|pair|market|instrument)$/i],
  ['side', /^(side|direction|long ?\/ ?short|position|type)$/i],
  ['setup', /^(setup|strategy|model|playbook)$/i],
  ['entry', /^(entry|entry price|price)$/i],
  ['sl', /^(sl|stop|stop loss|stoploss)$/i],
  ['tp1', /^(tp|tp1|target|take profit|tp 1)$/i],
  ['tp2', /^(tp2|tp 2|target 2)$/i],
  ['rr', /^(r:?r|rr|risk reward|r multiple|planned r:?r)$/i],
  ['score', /^(score|checklist|confluence|grade)$/i],
  ['tf', /^(tf|timeframe|entry tf)$/i],
  ['date', /^(date|time|opened|entry date|date opened)$/i],
  ['notes', /^(notes|note|comment|comments|reason|thesis)$/i],
];

function value(prop, v) {
  if (v == null || v === '') return null;
  switch (prop.type) {
    case 'title': return { title: [{ text: { content: String(v) } }] };
    case 'rich_text': return { rich_text: [{ text: { content: String(v) } }] };
    case 'number': { const n = Number(v); return Number.isFinite(n) ? { number: n } : null; }
    case 'select': {
      const opts = prop.select?.options || [];
      const hit = opts.find(o => o.name.toLowerCase() === String(v).toLowerCase());
      return { select: { name: hit ? hit.name : String(v).slice(0, 90) } };
    }
    case 'multi_select': return { multi_select: [{ name: String(v).slice(0, 90) }] };
    case 'date': return { date: { start: new Date(v).toISOString() } };
    case 'url': return { url: String(v) };
    default: return null;
  }
}

export default async function handler(req, res) {
  const token = process.env.NOTION_TOKEN, db = process.env.NOTION_DB_ID;
  if (!token || !db) return send(res, 501, { error: 'Notion is not set up (NOTION_TOKEN / NOTION_DB_ID).' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const t = await readJson(req);
  try {
    const sr = await fetch(NOTION + 'databases/' + db, { headers: H(token) });
    const schema = await sr.json();
    if (!sr.ok) return send(res, 502, { error: schema.message || 'Could not read the Notion database' });
    const props = {};
    const data = { ...t, date: t.date || new Date().toISOString() };
    let titleSet = false;
    for (const [name, prop] of Object.entries(schema.properties || {})) {
      const m = MATCH.find(([, re]) => re.test(name.trim()));
      if (prop.type === 'title') {
        props[name] = value(prop, `${t.coin} ${t.side} · ${t.setup}`);
        titleSet = true;
        continue;
      }
      if (!m) continue;
      const v = value(prop, data[m[0]]);
      if (v) props[name] = v;
    }
    if (!titleSet) return send(res, 502, { error: 'The Notion database has no title column.' });
    const body = {
      parent: { database_id: db }, properties: props,
      children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content:
        `${t.coin} ${t.side} · ${t.setup} · TF ${t.tf} · entry ${t.entry} · SL ${t.sl} · TP1 ${t.tp1} · TP2 ${t.tp2} · R:R ${t.rr} · score ${t.score}/9` } }] } }],
    };
    const r = await fetch(NOTION + 'pages', { method: 'POST', headers: H(token), body: JSON.stringify(body) });
    const j = await r.json();
    return send(res, r.ok ? 200 : 502, r.ok ? { ok: true, url: j.url } : { error: j.message || 'Notion error' });
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
}
