import express from 'express';
import { readFileSync } from 'node:fs';
import { db, totalSpend } from './db.js';
import { searchParcels, enrichParcel, hasKey, keySource, httpError } from './mireye.js';
import { storeMatches, parcelsGeoJSON } from './parcels.js';
import { ownershipFor } from './ownership.js';
import { reachFor, reachWithin, blockGroupsGeoJSON, hasDemographics } from './demographics.js';
import { getIsochrones, contoursByMinutes, pointInGeometry, hasMapbox } from './isochrone.js';

const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));
const app = express();
app.use(express.json());
app.use(express.static(new URL('../public/', import.meta.url).pathname));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  res.status(err.status ?? 500).json({ error: err.message });
});

app.get('/api/config', (req, res) => {
  res.json({ criteria, hasKey: hasKey(), hasDemographics: hasDemographics(), hasMapbox: hasMapbox(), spentUsd: totalSpend(), maxSpendUsd: Number(process.env.MAX_SPEND_USD ?? 2) });
});

app.get('/api/parcels', (req, res) => res.json(parcelsGeoJSON(criteria)));

app.get('/api/parcels/:id/profile', wrap(async (req, res) => {
  const p = db.prepare('SELECT parcelnumb, lat, lng FROM parcels WHERE parcelnumb = ?').get(req.params.id);
  if (!p) throw httpError(404, 'Parcel not found.');
  // Drive time is best-effort: a Mapbox failure shouldn't hide ownership or straight-line reach.
  let isochrones = null, driveError = null;
  try { isochrones = await getIsochrones(p.lat, p.lng, criteria.driveMinutes); } catch (err) { driveError = err.message; }
  res.json({
    ownership: ownershipFor(p.parcelnumb),
    reach: reachFor(p.lat, p.lng, criteria.reachMiles),
    drive: isochrones ? reachWithin(contoursByMinutes(isochrones), pointInGeometry) : null,
    isochrones,
    driveError,
  });
}));

app.get('/api/block-groups', (req, res) => res.json(blockGroupsGeoJSON()));

app.get('/api/datasets', (req, res) => res.json(db.prepare('SELECT * FROM dataset_meta').all()));

app.post('/api/search', wrap(async (req, res) => {
  const b = req.body ?? {};
  const s = criteria.search;
  const { matches, nextCursor, remarks, charged } = await searchParcels({
    county: criteria.county,
    acresMin: b.acresMin ?? s.acresMin,
    acresMax: b.acresMax ?? s.acresMax,
    minDevelopableAcres: b.minDevelopableAcres ?? s.minDevelopableAcres,
    maxWetlandFraction: b.maxWetlandFraction ?? s.maxWetlandFraction,
    city: b.city || null,
    limit: b.limit ?? 10,
    cursor: b.cursor,
  });
  const stored = storeMatches(matches);
  res.json({ found: matches.length, stored, nextCursor, remarks, chargedUsd: charged, spentUsd: totalSpend() });
}));

app.post('/api/parcels/:id/enrich', wrap(async (req, res) => {
  const p = db.prepare('SELECT parcelnumb, lat, lng FROM parcels WHERE parcelnumb = ?').get(req.params.id);
  if (!p) throw httpError(404, 'Parcel not found.');
  if (p.lat == null) throw httpError(400, 'Parcel has no coordinates to enrich.');
  const presets = Array.isArray(req.body?.presets) && req.body.presets.length ? req.body.presets : ['zoning', 'terrain', 'constraints'];
  const { result, charged } = await enrichParcel({ lat: p.lat, lng: p.lng, presets });
  const status = result.parcel_match?.status ?? 'unknown';
  const matchedId = result.parcel_match?.parcel?.parcelnumb;
  db.prepare('INSERT INTO enrichments (parcelnumb, presets, match_status, raw_json) VALUES (?, ?, ?, ?)')
    .run(p.parcelnumb, presets.join(','), status, JSON.stringify(result));
  res.json({
    status,
    sameParcel: matchedId ? String(matchedId) === p.parcelnumb : null,
    matchedParcel: matchedId ?? null,
    candidates: result.parcel_match?.candidates ?? [],
    fields: result.fields ?? {},
    chargedUsd: charged,
    spentUsd: totalSpend(),
  });
}));

app.get('/api/parcels/:id/enrichments', (req, res) => {
  const rows = db.prepare('SELECT id, presets, match_status, raw_json, created_at FROM enrichments WHERE parcelnumb = ? ORDER BY id DESC').all(req.params.id);
  res.json(rows.map((r) => ({ ...r, raw_json: undefined, fields: JSON.parse(r.raw_json).fields ?? {} })));
});

const STATUSES = new Set(['new', 'shortlist', 'rejected', 'contacted']);
app.patch('/api/parcels/:id', wrap(async (req, res) => {
  const { status, notes } = req.body ?? {};
  if (status != null && !STATUSES.has(status)) throw httpError(400, `Status must be one of: ${[...STATUSES].join(', ')}`);
  const r = db.prepare(`UPDATE parcels SET status = COALESCE(?, status), notes = COALESCE(?, notes), updated_at = datetime('now') WHERE parcelnumb = ?`)
    .run(status ?? null, notes ?? null, req.params.id);
  if (!r.changes) throw httpError(404, 'Parcel not found.');
  res.json({ ok: true });
}));

app.get('/api/zoning-rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM zoning_rules ORDER BY jurisdiction, zone, use').all());
});

app.put('/api/zoning-rules', wrap(async (req, res) => {
  const { jurisdiction, zone, use, verdict, source_url = null, notes = null } = req.body ?? {};
  if (!jurisdiction || !zone || !criteria.uses.includes(use)) throw httpError(400, 'jurisdiction, zone and a known use are required.');
  db.prepare(`INSERT INTO zoning_rules (jurisdiction, zone, use, verdict, source_url, notes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(jurisdiction, zone, use) DO UPDATE SET verdict=excluded.verdict, source_url=excluded.source_url, notes=excluded.notes, updated_at=datetime('now')`)
    .run(jurisdiction, zone, use, verdict, source_url, notes);
  res.json({ ok: true });
}));

app.get('/api/calls', (req, res) => {
  res.json(db.prepare('SELECT id, endpoint, status, charged_usd, result_count, error, created_at FROM api_calls ORDER BY id DESC LIMIT 50').all());
});

const port = Number(process.env.PORT ?? 4310);
app.listen(port, () => console.log(`Paydirt on http://localhost:${port} (Mireye key ${keySource() ? 'from ' + keySource() : 'missing'})`));
