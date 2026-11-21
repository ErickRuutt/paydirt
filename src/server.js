import express from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { readFileSync } from 'node:fs';
import { all, one, run, totalSpend } from './db.js';
import { searchParcels, enrichParcel, hasKey, keySource, httpError } from './mireye.js';
import { storeMatches, parcelsGeoJSON } from './parcels.js';
import { ownershipFor } from './ownership.js';
import { reachFor, reachWithin, blockGroupsGeoJSON, hasDemographics } from './demographics.js';
import { getIsochrones, contoursByMinutes, pointInGeometry, hasMapbox } from './isochrone.js';
import { listCandidates, getCandidate, reviewCandidate, REVIEW_STATUSES, KEY_FIELDS } from './candidates.js';
import { KC_CODE_SOURCE } from './zoning-kc.js';

const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));
const app = express();
app.use(express.json());
app.use(express.static(new URL('../public/', import.meta.url).pathname));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  res.status(err.status ?? 500).json({ error: err.message });
});
// Sign-in: the page and its static files are public; every /api route except the key lookup needs a Clerk session.
app.get('/api/auth-config', (req, res) => res.json({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? null }));
app.use('/api', clerkMiddleware(), (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in required.' });
  req.userId = userId;
  next();
});

const parcelPoint = (id) => one('SELECT parcelnumb, lat, lng FROM parcels WHERE parcelnumb = ?', [id]);

app.get('/api/config', wrap(async (req, res) => {
  res.json({
    criteria, hasKey: hasKey(), hasDemographics: await hasDemographics(), hasMapbox: hasMapbox(),
    spentUsd: await totalSpend(), maxSpendUsd: Number(process.env.MAX_SPEND_USD ?? 2),
  });
}));

app.get('/api/parcels', wrap(async (req, res) => res.json(await parcelsGeoJSON(criteria))));

// Ownership history, straight-line reach and drive-time reach for a point.
async function profileFor(pin, lat, lng) {
  // Drive time is best-effort: a Mapbox failure shouldn't hide ownership or straight-line reach.
  let isochrones = null, driveError = null;
  try { isochrones = await getIsochrones(lat, lng, criteria.driveMinutes); } catch (err) { driveError = err.message; }
  const [ownership, reach, drive] = await Promise.all([
    ownershipFor(pin),
    reachFor(lat, lng, criteria.reachMiles),
    isochrones ? reachWithin(contoursByMinutes(isochrones), pointInGeometry) : null,
  ]);
  return { ownership, reach, drive, isochrones, driveError };
}

app.get('/api/parcels/:id/profile', wrap(async (req, res) => {
  const p = await parcelPoint(req.params.id);
  if (!p) throw httpError(404, 'Parcel not found.');
  res.json(await profileFor(p.parcelnumb, p.lat, p.lng));
}));

// ---------- Candidates: every 5+ acre parcel, scored from free county data ----------
app.get('/api/candidates', wrap(async (req, res) => res.json(await listCandidates(req.query))));

app.get('/api/candidates/:pin', wrap(async (req, res) => {
  const c = await getCandidate(req.params.pin);
  if (!c) throw httpError(404, 'Candidate not found.');
  const enr = await one('SELECT raw_json, created_at FROM enrichments WHERE parcelnumb = ? ORDER BY id DESC LIMIT 1', [c.pin]);
  res.json({ ...c, zoningSource: KC_CODE_SOURCE, keyFields: KEY_FIELDS,
    enrichment: enr ? { fields: JSON.parse(enr.raw_json).fields ?? {}, created_at: enr.created_at } : null });
}));

app.get('/api/candidates/:pin/profile', wrap(async (req, res) => {
  const c = await one('SELECT pin, lat, lng FROM candidates WHERE pin = ?', [req.params.pin]);
  if (!c) throw httpError(404, 'Candidate not found.');
  res.json(await profileFor(c.pin, c.lat, c.lng));
}));

app.patch('/api/candidates/:pin', wrap(async (req, res) => {
  const { status, notes } = req.body ?? {};
  if (status != null && !REVIEW_STATUSES.includes(status)) throw httpError(400, `Status must be one of: ${REVIEW_STATUSES.join(', ')}`);
  if (!(await one('SELECT 1 FROM candidates WHERE pin = ?', [req.params.pin]))) throw httpError(404, 'Candidate not found.');
  await reviewCandidate(req.params.pin, { status, notes }, req.userId);
  res.json({ ok: true });
}));

app.post('/api/candidates/:pin/enrich', wrap(async (req, res) => {
  const c = await one('SELECT pin, lat, lng FROM candidates WHERE pin = ?', [req.params.pin]);
  if (!c) throw httpError(404, 'Candidate not found.');
  const presets = ['zoning', 'terrain', 'constraints'];
  const { result, charged } = await enrichParcel({ lat: c.lat, lng: c.lng, presets });
  const status = result.parcel_match?.status ?? 'unknown';
  const matchedId = result.parcel_match?.parcel?.parcelnumb;
  await run('INSERT INTO enrichments (parcelnumb, presets, match_status, raw_json) VALUES (?, ?, ?, ?)',
    [c.pin, presets.join(','), status, JSON.stringify(result)]);
  res.json({
    status,
    samePin: matchedId ? String(matchedId).replace(/\D/g, '') === c.pin : null,
    matchedParcel: matchedId ?? null,
    fields: result.fields ?? {},
    chargedUsd: charged,
    spentUsd: await totalSpend(),
  });
}));

app.get('/api/block-groups', wrap(async (req, res) => res.json(await blockGroupsGeoJSON())));

app.get('/api/datasets', wrap(async (req, res) => res.json(await all('SELECT * FROM dataset_meta'))));

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
  const stored = await storeMatches(matches);
  res.json({ found: matches.length, stored, nextCursor, remarks, chargedUsd: charged, spentUsd: await totalSpend() });
}));

app.post('/api/parcels/:id/enrich', wrap(async (req, res) => {
  const p = await parcelPoint(req.params.id);
  if (!p) throw httpError(404, 'Parcel not found.');
  if (p.lat == null) throw httpError(400, 'Parcel has no coordinates to enrich.');
  const presets = Array.isArray(req.body?.presets) && req.body.presets.length ? req.body.presets : ['zoning', 'terrain', 'constraints'];
  const { result, charged } = await enrichParcel({ lat: p.lat, lng: p.lng, presets });
  const status = result.parcel_match?.status ?? 'unknown';
  const matchedId = result.parcel_match?.parcel?.parcelnumb;
  await run('INSERT INTO enrichments (parcelnumb, presets, match_status, raw_json) VALUES (?, ?, ?, ?)',
    [p.parcelnumb, presets.join(','), status, JSON.stringify(result)]);
  res.json({
    status,
    sameParcel: matchedId ? String(matchedId) === p.parcelnumb : null,
    matchedParcel: matchedId ?? null,
    candidates: result.parcel_match?.candidates ?? [],
    fields: result.fields ?? {},
    chargedUsd: charged,
    spentUsd: await totalSpend(),
  });
}));

app.get('/api/parcels/:id/enrichments', wrap(async (req, res) => {
  const rows = await all('SELECT id, presets, match_status, raw_json, created_at FROM enrichments WHERE parcelnumb = ? ORDER BY id DESC', [req.params.id]);
  res.json(rows.map((r) => ({ ...r, raw_json: undefined, fields: JSON.parse(r.raw_json).fields ?? {} })));
}));

const STATUSES = new Set(['new', 'shortlist', 'rejected', 'contacted']);
app.patch('/api/parcels/:id', wrap(async (req, res) => {
  const { status, notes } = req.body ?? {};
  if (status != null && !STATUSES.has(status)) throw httpError(400, `Status must be one of: ${[...STATUSES].join(', ')}`);
  const r = await run('UPDATE parcels SET status = COALESCE(?, status), notes = COALESCE(?, notes), updated_at = now() WHERE parcelnumb = ?',
    [status ?? null, notes ?? null, req.params.id]);
  if (!r.rowCount) throw httpError(404, 'Parcel not found.');
  res.json({ ok: true });
}));

app.get('/api/zoning-rules', wrap(async (req, res) => {
  res.json(await all('SELECT * FROM zoning_rules ORDER BY jurisdiction, zone, use'));
}));

app.put('/api/zoning-rules', wrap(async (req, res) => {
  const { jurisdiction, zone, use, verdict, source_url = null, notes = null } = req.body ?? {};
  if (!jurisdiction || !zone || !criteria.uses.includes(use)) throw httpError(400, 'jurisdiction, zone and a known use are required.');
  await run(`INSERT INTO zoning_rules (jurisdiction, zone, use, verdict, source_url, notes) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (jurisdiction, zone, use) DO UPDATE SET verdict = excluded.verdict, source_url = excluded.source_url, notes = excluded.notes, updated_at = now()`,
    [jurisdiction, zone, use, verdict, source_url, notes]);
  res.json({ ok: true });
}));

app.get('/api/calls', wrap(async (req, res) => {
  res.json(await all('SELECT id, endpoint, status, charged_usd, result_count, error, created_at FROM api_calls ORDER BY id DESC LIMIT 50'));
}));

// Vercel imports the app; locally we listen.
export default app;
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 4310);
  app.listen(port, () => console.log(`Paydirt on http://localhost:${port} (Mireye key ${keySource() ? 'from ' + keySource() : 'missing'})`));
}
