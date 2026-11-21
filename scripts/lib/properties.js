// Master property registry: every parcel gets a permanent property_uid the first time it's seen,
// keyed by (source, source_id). Refreshes keep the same UID and only move last_seen_at.
import { newId } from '../../src/ids.js';
import { insertMany } from './pg-script.js';

export async function syncProperties(client, { source, countyFips, sourceIds }) {
  const { rows } = await client.query('SELECT property_uid, source_id FROM properties WHERE source = $1', [source]);
  const known = new Map(rows.map((r) => [r.source_id, r.property_uid]));
  const fresh = [];
  for (const id of new Set(sourceIds)) if (!known.has(id)) { const uid = newId('prop'); known.set(id, uid); fresh.push([uid, source, id, countyFips]); }
  if (fresh.length) await insertMany(client, 'properties', ['property_uid', 'source', 'source_id', 'county_fips'], fresh);
  await client.query('UPDATE properties SET last_seen_at = now() WHERE source = $1 AND source_id = ANY($2)', [source, [...new Set(sourceIds)]]);
  return { map: known, added: fresh.length };
}
