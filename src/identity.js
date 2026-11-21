import { one, run } from './db.js';
import { newId } from './ids.js';

// Maps a Clerk sign-in to Paydirt's own IDs (usr_…, org_…). Everyone joins the default "Paydirt"
// organization for now; Clerk organizations can map onto orgs.clerk_org_id later.
const cache = new Map();

async function defaultOrg() {
  const o = await one("SELECT org_uid FROM orgs WHERE name = 'Paydirt' ORDER BY created_at LIMIT 1");
  if (o) return o.org_uid;
  const uid = newId('org');
  await run("INSERT INTO orgs (org_uid, name) VALUES (?, 'Paydirt') ON CONFLICT DO NOTHING", [uid]);
  return uid;
}

export async function ensureUser(clerkUserId) {
  if (!clerkUserId) return null;
  const hit = cache.get(clerkUserId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.user;
  let u = await one('SELECT user_uid, org_uid FROM users WHERE clerk_user_id = ?', [clerkUserId]);
  if (!u) {
    u = { user_uid: newId('usr'), org_uid: await defaultOrg() };
    await run('INSERT INTO users (user_uid, clerk_user_id, org_uid) VALUES (?, ?, ?) ON CONFLICT (clerk_user_id) DO NOTHING', [u.user_uid, clerkUserId, u.org_uid]);
    u = await one('SELECT user_uid, org_uid FROM users WHERE clerk_user_id = ?', [clerkUserId]);
  } else {
    await run('UPDATE users SET last_seen_at = now() WHERE clerk_user_id = ?', [clerkUserId]);
  }
  const user = { uid: u.user_uid, orgUid: u.org_uid, clerkId: clerkUserId };
  cache.set(clerkUserId, { user, at: Date.now() });
  return user;
}

// Append-only event log: the groundwork for bookmark counts and interest reporting.
// Reports across organizations must only use totals, never who saved what.
export async function logEvent(type, { propertyUid = null, ppUid = null, projectId = null, user = null, data = null } = {}) {
  await run('INSERT INTO events (event_uid, type, property_uid, pp_uid, project_id, org_uid, user_uid, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [newId('evt'), type, propertyUid, ppUid, projectId, user?.orgUid ?? null, user?.uid ?? null, data ? JSON.stringify(data) : null]);
}
