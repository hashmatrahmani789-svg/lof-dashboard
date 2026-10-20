// Price alerts saved in the cloud, so the 5-minute scanner can check them when the dashboard is closed.
// GET → { enabled, alerts }   POST {action:'add', alert} | {action:'update', id, patch} | {action:'delete', id} | {action:'clear'}
import { send, readJson } from './_lib.js';
import { storeOn, getAlerts, updateAlerts } from './_store.js';

export default async function handler(req, res) {
  if (!storeOn()) return send(res, 200, { enabled: false, alerts: [] });
  try {
    if (req.method === 'GET') return send(res, 200, { enabled: true, alerts: await getAlerts() });
    const b = await readJson(req);
    const alerts = await updateAlerts(list => {
      if (b.action === 'add' && b.alert && b.alert.id) { if (!list.some(a => a.id === b.alert.id)) list.push(b.alert); }
      else if (b.action === 'update') { const a = list.find(x => x.id === b.id); if (a) Object.assign(a, b.patch || {}); }
      else if (b.action === 'delete') return list.filter(a => a.id !== b.id);
      else if (b.action === 'clear') return list.filter(a => a.status === 'active');
      return list;
    });
    return send(res, 200, { enabled: true, alerts });
  } catch (e) {
    return send(res, 502, { error: String(e.message || e) });
  }
}
