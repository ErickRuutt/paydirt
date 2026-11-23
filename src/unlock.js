import { all, one, pool } from './db.js';
import { newId } from './ids.js';
import { httpError } from './mireye.js';
import { countyOf, countParcels } from './counties.js';
import { fillAddresses } from './addresses.js';
import { closeRequestsFor } from './areas.js';
import { insertMany, setMeta } from '../scripts/lib/pg-script.js';
import { syncProperties } from '../scripts/lib/properties.js';

// Unlocking a county: name a place ("Sequim"), Paydirt finds its county, counts the parcels of the size you
// want (free), prices them in credits, and on confirm deducts the credits and loads the parcels.
//
// Price: parcels × our data cost per parcel × markup, never under a minimum. 1 credit = $1.
// The per-parcel cost is what a nationwide paid parcel source charges (~$0.02 each), so the price stays
// right when a county has no free source and we have to buy the data.
export const PRICING = {
  perParcelUsd: Number(process.env.UNLOCK_PER_PARCEL_USD ?? 0.02),
  markup: Number(process.env.UNLOCK_MARKUP ?? 2),
  minCredits: Number(process.env.UNLOCK_MIN_CREDITS ?? 20),
};
export const priceFor = (parcels) => Math.max(PRICING.minCredits, Math.ceil(parcels * PRICING.perParcelUsd * PRICING.markup));
export const SIZES = [1, 5, 10, 20, 40];

const UA = 'Paydirt/1.0 (land research tool)';

// Place text → county, via OpenStreetMap (place) and the FCC Census area API (county FIPS).
export async function resolvePlace(text) {
  const q = String(text ?? '').trim();
  if (!q) throw httpError(400, 'Name a town, city or county.');
  if (q.length > 120) throw httpError(400, 'Keep the place name under 120 characters.');
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, countrycodes: 'us', format: 'jsonv2', addressdetails: '1', limit: '1' })}`;
  const hit = (await (await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })).json())[0];
  if (!hit) throw httpError(404, `Couldn't find "${q}" in the US. Try adding the state, e.g. "${q}, WA".`);
  const area = await (await fetch(`https://geo.fcc.gov/api/census/area?lat=${hit.lat}&lon=${hit.lon}&format=json`, { signal: AbortSignal.timeout(15_000) })).json();
  const r = area.results?.[0];
  if (!r) throw httpError(404, `Couldn't tell which county "${q}" is in.`);
  const name = hit.name || q;
  return { place: name, label: hit.display_name, fips: r.county_fips, county: r.county_name, state: r.state_code };
}

export async function creditBalance(orgUid) {
  return (await one('SELECT COALESCE(sum(delta), 0)::int AS n FROM credit_ledger WHERE org_uid = ?', [orgUid ?? null])).n;
}

export async function quote(orgUid, { place, minAcres = 10 }) {
  minAcres = SIZES.includes(Number(minAcres)) ? Number(minAcres) : 10;
  const p = await resolvePlace(place);
  const c = countyOf(p.fips);
  const loaded = (await one("SELECT count(*)::int AS n FROM candidates WHERE county_fips = ? AND acres >= ? AND excluded IS DISTINCT FROM 'no assessed value (public land, roads or water)'", [p.fips, minAcres])).n;
  const owned = await one(`SELECT unlock_uid, min_acres, created_at FROM county_unlocks WHERE org_uid = ? AND county_fips = ? AND status = 'done'
    AND min_acres <= ? ORDER BY created_at DESC LIMIT 1`, [orgUid ?? null, p.fips, minAcres]);
  const base = { ...p, minAcres, sizes: SIZES, balance: await creditBalance(orgUid), loaded, unlocked: Boolean(owned || c?.loadedByScript) };
  if (!c || (!c.load && !c.loadedByScript)) {
    return { ...base, supported: false, parcels: null, credits: null,
      why: `Paydirt can't load ${p.county}, ${p.state} on its own yet: its parcel source hasn't been connected. Request it and we'll add it.` };
  }
  const parcels = await countParcels(p.fips, minAcres);
  return { ...base, supported: true, parcels, credits: priceFor(parcels), includes: c.includes ?? null }; // our costs and markup never leave the server
}

// Charge, load, and refund if loading fails. The advisory lock makes two unlocks by one org run one at a time,
// so a balance can't be spent twice.
export async function unlockCounty(user, { place, minAcres, projectId }) {
  const orgUid = user?.orgUid;
  if (!orgUid) throw httpError(403, 'Join an organization before unlocking areas.');
  const q = await quote(orgUid, { place, minAcres });
  if (!q.supported) throw httpError(400, q.why);
  if (q.unlocked) { await closeRequestsFor(orgUid, q.fips); return { ...q, status: 'done', already: true }; }
  const uid = newId('unl');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credits:${orgUid}`]);
    const bal = (await client.query('SELECT COALESCE(sum(delta), 0)::int AS n FROM credit_ledger WHERE org_uid = $1', [orgUid])).rows[0].n;
    if (bal < q.credits) throw httpError(402, `Unlocking costs ${q.credits} credits; you have ${bal}.`);
    await client.query(`INSERT INTO county_unlocks (unlock_uid, org_uid, county_fips, county_name, place, min_acres, parcels, credits, created_by, project_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [uid, orgUid, q.fips, `${q.county}, ${q.state}`, q.place, q.minAcres, q.parcels, q.credits, user?.uid ?? null, Number(projectId) || null]);
    await client.query(`INSERT INTO credit_ledger (entry_uid, org_uid, delta, reason, ref, note, created_by) VALUES ($1, $2, $3, 'county_unlock', $4, $5, $6)`,
      [newId('crd'), orgUid, -q.credits, uid, `${q.county}, ${q.state}: ${q.parcels} parcels of ${q.minAcres}+ acres`, user?.uid ?? null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }

  try {
    const n = q.loaded >= q.parcels * 0.95 ? q.loaded : await loadCounty(q.fips, q.minAcres); // already loaded for someone else
    await one("UPDATE county_unlocks SET status = 'done', loaded = ?, finished_at = now() WHERE unlock_uid = ? RETURNING unlock_uid", [n, uid]);
    await closeRequestsFor(orgUid, q.fips);
    return { ...q, status: 'done', loaded: n, balance: await creditBalance(orgUid) };
  } catch (e) {
    await one("UPDATE county_unlocks SET status = 'failed', error = ?, finished_at = now() WHERE unlock_uid = ? RETURNING unlock_uid", [String(e.message).slice(0, 500), uid]);
    await one(`INSERT INTO credit_ledger (entry_uid, org_uid, delta, reason, ref, note) VALUES (?, ?, ?, 'refund', ?, ?) RETURNING entry_uid`,
      [newId('crd'), orgUid, q.credits, uid, `Loading ${q.county} failed; credits returned.`]);
    throw httpError(502, `Loading ${q.county} failed, so your ${q.credits} credits were returned. (${e.message})`);
  }
}

const COLS = ['pin', 'address', 'city', 'postal_city', 'zip', 'acres', 'zoning', 'sports_verdict', 'sports_note', 'zoning_source', 'present_use',
  'land_value', 'impr_value', 'mail_address', 'mail_city_state', 'absentee', 'out_of_state', 'lat', 'lng', 'geometry_json',
  'years_held', 'years_since_transfer', 'signals', 'excluded', 'tags', 'businesses', 'owner_type', 'current_use', 'county_fips'];

// Replace a county's rows in one transaction, so a failed load leaves the old rows in place.
export async function loadCounty(fips, minAcres) {
  const c = countyOf(fips);
  const { rows, source, sourceLabel } = await c.load(minAcres);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM candidates WHERE county_fips = $1 AND acres >= $2', [fips, minAcres]);
    await insertMany(client, 'candidates', COLS, rows.map((r) => COLS.map((k) => (k === 'county_fips' ? fips : r[k] ?? null))), { onConflict: 'ON CONFLICT (pin) DO NOTHING' });
    await syncProperties(client, { source, countyFips: fips, sourceIds: rows.map((r) => r.pin) });
    await client.query('UPDATE candidates c SET property_uid = p.property_uid FROM properties p WHERE p.source = $1 AND p.source_id = c.pin AND c.county_fips = $2', [source, fips]);
    await setMeta(client, `candidates_${fips}`, rows.length, sourceLabel);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  // Addresses are a nice-to-have: a failure here never undoes the unlock.
  await fillAddresses(fips).catch((e) => console.error(`Addresses for ${fips}: ${e.message}`));
  return rows.length;
}

export async function listUnlocks(orgUid, projectId = null) {
  return all(`SELECT unlock_uid, county_name, place, min_acres, parcels, credits, status, loaded, error, created_at, project_id FROM county_unlocks
    WHERE org_uid = ? ${projectId ? 'AND project_id = ?' : ''} ORDER BY created_at DESC LIMIT 50`, projectId ? [orgUid ?? null, Number(projectId)] : [orgUid ?? null]);
}

export async function grantCredits(orgUid, amount, note, by = null) {
  amount = Math.trunc(Number(amount));
  if (!orgUid || !amount) throw new Error('An org and a whole number of credits are required.');
  await one(`INSERT INTO credit_ledger (entry_uid, org_uid, delta, reason, note, created_by) VALUES (?, ?, ?, 'grant', ?, ?) RETURNING entry_uid`,
    [newId('crd'), orgUid, amount, note ?? null, by]);
  return creditBalance(orgUid);
}
