import express from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { readFileSync } from 'node:fs';
import { all, one, run, totalSpend } from './db.js';
import { searchParcels, enrichParcel, hasKey, keySource, httpError } from './mireye.js';
import { storeMatches, parcelsGeoJSON } from './parcels.js';
import { ownershipFor } from './ownership.js';
import { reachFor, reachWithin, blockGroupsGeoJSON, hasDemographics } from './demographics.js';
import { getIsochrones, contoursByMinutes, pointInGeometry, hasMapbox } from './isochrone.js';
import { KEY_FIELDS } from './candidates.js';
import { specToChips, applyChipEdit, CHIP_CATALOG } from './chips.js';
import { previewCount, listProjects, getProject, createProject, updateProject, projectHistory, reviewParcel, setSaved, orgSaved, projectCandidates, projectCandidate, REVIEW_STATUSES } from './projects.js';
import { ensureUser } from './identity.js';
import { REQUIREMENT_FIELDS, PREFERENCE_FIELDS, SIGNAL_LABELS, TAG_LABELS } from './spec.js';
import { draftFromText, interviewTurn, hasClaude } from './compiler.js';
import { logFeedback } from './feedback.js';
import { fitStatement } from './fit.js';
import { nearRoad } from './addresses.js';
import { researchParcel, latestResearch, RESEARCH_CREDITS } from './research.js';
import { coverage, listRequests, requestArea, AREA_KINDS, AREA_STATUSES } from './areas.js';
import { quote, unlockCounty, listUnlocks, creditBalance, resolvePlace, SIZES } from './unlock.js';
import { listAreas, addArea, removeArea, areaLabel } from './projectAreas.js';

const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));
const app = express();
app.use(express.json({ limit: '1mb' })); // briefs can be long
app.use(express.static(new URL('../public/', import.meta.url).pathname));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  res.status(err.status ?? 500).json({ error: err.message, ...(err.project ? { project: withChips(err.project) } : {}) });
});
// The Where chip shows the project's areas (kept apart from the criteria, src/projectAreas.js) next to its own rules.
function withChips(p) {
  if (!p?.spec) return p;
  const chips = specToChips(p.spec);
  const where = chips.find((c) => c.key === 'where');
  if (where && p.areas?.length) where.must = { ...(where.must ?? {}), area: p.areas.map(areaLabel) };
  return { ...p, chips };
}
// Sign-in: the page and its static files are public; every /api route except the key lookup needs a Clerk session.
app.get('/api/auth-config', (req, res) => res.json({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY ?? null }));
app.use('/api', clerkMiddleware(), (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Sign in required.' });
  req.userId = userId;
  // Paydirt's own identity (usr_…, org_…) for this Clerk sign-in; everything is scoped to the org.
  ensureUser(userId).then((u) => { req.user = u; next(); }, next);
});

const parcelPoint = (id) => one('SELECT parcelnumb, lat, lng FROM parcels WHERE parcelnumb = ?', [id]);

app.get('/api/config', wrap(async (req, res) => {
  res.json({
    criteria, hasKey: hasKey(), hasDemographics: await hasDemographics(), hasMapbox: hasMapbox(), hasClaude: hasClaude(),
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
// ---------- Projects: one buyer's search (docs/projects-spec.md) ----------
const projectOr404 = async (id, req) => {
  const p = await getProject(id, req.user.orgUid);
  if (!p) throw httpError(404, 'Project not found.');
  return p;
};
app.get('/api/projects', wrap(async (req, res) => res.json({
  projects: (await listProjects(req.user.orgUid)).map(withChips),
  catalog: { requirements: REQUIREMENT_FIELDS, preferences: PREFERENCE_FIELDS, signals: SIGNAL_LABELS, tags: TAG_LABELS, criteria: CHIP_CATALOG },
})));
const SOURCES = new Set(['form', 'markdown', 'interview', 'chip', 'undo']);
const sourceOf = (b) => (SOURCES.has(b?.source) ? b.source : 'form');
app.post('/api/projects', wrap(async (req, res) => res.json(await createProject(req.body ?? {}, req.user, sourceOf(req.body)))));
app.get('/api/projects/:id', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  res.json({ ...withChips(p), history: await projectHistory(p.id) });
}));
// A body may carry a whole spec, or one chip edit ({ chip: { key, edit } }) applied to the current spec.
// baseVersion is the version the person was looking at; a stale one is refused with the current project.
const specFrom = (p, body) => (body?.chip ? applyChipEdit(p.spec, body.chip.key, body.chip.edit) : body?.spec);
app.put('/api/projects/:id', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const body = req.body ?? {};
  const saved = await updateProject(p.id, { ...body, spec: specFrom(p, body) }, req.user, body.chip ? 'chip' : sourceOf(body));
  res.json({ ...withChips(saved), history: await projectHistory(p.id) });
}));
app.post('/api/projects/:id/preview', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  res.json({ count: await previewCount(p, specFrom(p, req.body) ?? p.spec, { hidePassed: req.body?.hidePassed !== false }) });
}));

// Drafts: Claude turns a brief or an interview into criteria. Nothing is saved until a person applies it.
app.post('/api/drafts/from-text', wrap(async (req, res) => {
  const current = req.body?.projectId ? (await projectOr404(req.body.projectId, req)).spec : null;
  res.json(await draftFromText({ text: req.body?.text, current }));
}));
app.post('/api/drafts/interview', wrap(async (req, res) => res.json(await interviewTurn({ messages: req.body?.messages }))));

app.get('/api/projects/:id/candidates', wrap(async (req, res) => res.json(await projectCandidates(await projectOr404(req.params.id, req), req.query))));
app.get('/api/projects/:id/candidates/:pin', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const c = await projectCandidate(p, req.params.pin);
  if (!c) throw httpError(404, 'Parcel not found.');
  if (!c.address) c.address_near = await nearRoad(c.pin); // no address: name the closest road (cached)
  const enr = await one('SELECT raw_json, created_at FROM enrichments WHERE parcelnumb = ? ORDER BY id DESC LIMIT 1', [c.pin]);
  res.json({ ...c, keyFields: KEY_FIELDS, enrichment: enr ? { fields: JSON.parse(enr.raw_json).fields ?? {}, created_at: enr.created_at } : null });
}));
app.patch('/api/projects/:id/reviews/:pin', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const { status, notes } = req.body ?? {};
  if (status != null && !REVIEW_STATUSES.includes(status)) throw httpError(400, `Status must be one of: ${REVIEW_STATUSES.join(', ')}`);
  if (!(await one('SELECT 1 FROM candidates WHERE pin = ?', [req.params.pin]))) throw httpError(404, 'Parcel not found.');
  await reviewParcel(p, req.params.pin, { status, notes }, req.user);
  res.json({ ok: true });
}));

// Save (bookmark) a parcel to a project. Body: { saved: true|false }.
app.put('/api/projects/:id/saved/:pin', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const pp = await setSaved(p, req.params.pin, Boolean(req.body?.saved), req.user);
  res.json({ ok: true, saved: pp.saved, pp_uid: pp.pp_uid, property_uid: pp.property_uid });
}));

// A project's saved properties, scored for that project, with status and notes.
app.get('/api/projects/:id/saved', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const rows = await all(`SELECT pp.pp_uid, pp.property_uid, pp.status, pp.notes, pp.saved_at, pp.updated_at, c.pin
    FROM project_properties pp JOIN candidates c ON c.property_uid = pp.property_uid WHERE pp.project_id = ? AND pp.saved ORDER BY pp.saved_at DESC`, [p.id]);
  const scored = rows.length ? await projectCandidates(p, { pins: rows.map((r) => r.pin).join(','), limit: 1000 }) : { features: [] };
  const byPin = new Map(scored.features.map((f) => [f.properties.pin, f.properties]));
  res.json({ project: { id: p.id, project_uid: p.project_uid, name: p.name, brief: p.brief, spec_version: p.spec_version },
    saved: rows.map((r) => ({ ...r, ...(byPin.get(r.pin) ?? {}), status: r.status, hiddenByCriteria: !byPin.has(r.pin) })) });
}));

// ---------- Fit statement: the argument for (or against) one site, for this project ----------
app.get('/api/projects/:id/fit/:pin', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const c = await projectCandidate(p, req.params.pin);
  if (!c) throw httpError(404, 'Parcel not found.');
  if (!c.address) c.address_near = await nearRoad(c.pin);
  res.json(await fitStatement(p, c));
}));
// Several sites side by side (default: the project's saved sites that aren't passed, up to 12).
app.get('/api/projects/:id/fit', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  let pins = String(req.query.pins ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!pins.length) pins = (await all(`SELECT c.pin FROM project_properties pp JOIN candidates c ON c.property_uid = pp.property_uid
    WHERE pp.project_id = ? AND pp.saved AND pp.status <> 'rejected' ORDER BY pp.saved_at DESC`, [p.id])).map((r) => r.pin);
  const out = [];
  for (const pin of pins.slice(0, 12)) { const c = await projectCandidate(p, pin); if (c) out.push(await fitStatement(p, c)); }
  res.json({ project: { id: p.id, name: p.name, version: p.spec_version }, statements: out });
}));

// ---------- Web research on one parcel (cited findings; costs credits) ----------
app.get('/api/candidates/:pin/research', wrap(async (req, res) => res.json({ latest: await latestResearch(req.params.pin), credits: RESEARCH_CREDITS })));
app.post('/api/projects/:id/research/:pin', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const c = await projectCandidate(p, req.params.pin);
  if (!c) throw httpError(404, 'Parcel not found.');
  if (!c.address) c.address_near = await nearRoad(c.pin);
  res.json(await researchParcel(req.user, c));
}));

// ---------- Areas: coverage, and requests to unlock more ----------
app.get('/api/areas', wrap(async (req, res) => res.json({ ...(await coverage()), requests: await listRequests(req.user.orgUid), unlocks: await listUnlocks(req.user.orgUid),
  balance: await creditBalance(req.user.orgUid), sizes: SIZES, kinds: AREA_KINDS, statuses: AREA_STATUSES })));
// Unlock a county: quote (free), then unlock (deducts credits and loads the parcels).
app.get('/api/areas/quote', wrap(async (req, res) => res.json(await quote(req.user.orgUid, { place: req.query.place, minAcres: req.query.minAcres }))));
app.post('/api/areas/unlock', wrap(async (req, res) => {
  const { projectId } = req.body ?? {};
  if (projectId) await projectOr404(projectId, req); // only your organization's projects
  res.json(await unlockCounty(req.user, req.body ?? {}));
}));
// One project's areas: what it has requested and unlocked, plus the credit balance.
app.get('/api/projects/:id/areas', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  res.json({ areas: await listAreas(p), requests: await listRequests(req.user.orgUid, p.id), unlocks: await listUnlocks(req.user.orgUid, p.id),
    balance: await creditBalance(req.user.orgUid), sizes: SIZES, kinds: AREA_KINDS, statuses: AREA_STATUSES });
}));
// Add a place Paydirt already holds to a project's search, or take one out. { place, wholeCounty }
app.post('/api/projects/:id/areas', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  const at = await resolvePlace(req.body?.place);
  await addArea(p, { fips: at.fips, countyName: `${at.county}, ${at.state}`, place: req.body?.wholeCounty ? null : at.place }, req.user);
  res.json({ areas: await listAreas(p) });
}));
app.delete('/api/projects/:id/areas/:uid', wrap(async (req, res) => {
  const p = await projectOr404(req.params.id, req);
  await removeArea(p, req.params.uid);
  res.json({ areas: await listAreas(p) });
}));
app.post('/api/areas/requests', wrap(async (req, res) => {
  if (req.body?.projectId) await projectOr404(req.body.projectId, req);
  res.json(await requestArea(req.user, req.userId, req.body ?? {}));
}));

// ---------- Feedback (saved here, copied to Notion for review) ----------
app.post('/api/feedback', wrap(async (req, res) => res.json(await logFeedback(req.user, req.userId, req.body ?? {}))));

// ---------- Home: who you are, your projects, everything saved across them ----------
app.get('/api/me', wrap(async (req, res) => {
  const org = await one('SELECT org_uid, name FROM orgs WHERE org_uid = ?', [req.user.orgUid]);
  res.json({ user_uid: req.user.uid, org });
}));
app.get('/api/home', wrap(async (req, res) => {
  const [projects, saved, org] = await Promise.all([listProjects(req.user.orgUid), orgSaved(req.user.orgUid), one('SELECT org_uid, name FROM orgs WHERE org_uid = ?', [req.user.orgUid])]);
  res.json({ org, projects: projects.map(({ spec, ...p }) => ({ ...p, criteria: spec.requirements.length + spec.preferences.length })),
    saved: saved.map((r) => ({ ...r, tags: JSON.parse(r.tags ?? '[]') })) });
}));

// Parcel facts shared by every project (the data layer).
app.get('/api/candidates/:pin/profile', wrap(async (req, res) => {
  const c = await one('SELECT pin, lat, lng FROM candidates WHERE pin = ?', [req.params.pin]);
  if (!c) throw httpError(404, 'Candidate not found.');
  res.json(await profileFor(c.pin, c.lat, c.lng));
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
