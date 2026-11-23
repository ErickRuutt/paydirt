import { all, one, run } from './db.js';
import { newId } from './ids.js';
import { httpError } from './mireye.js';
import { logFeedback } from './feedback.js';
import { countyOf, isLoadable, fipsForCounty } from './counties.js';

// Areas: what Paydirt covers today, and requests to unlock more (a county, a city, or a city's zoning).
// A request is saved here (so its status shows in the app) and copied to the Notion feedback table for review.

export const AREA_KINDS = { city: 'A town or city not covered yet', county: 'A whole county', zoning: 'Zoning rules for a covered city' };
export const AREA_STATUSES = { requested: 'Requested', in_progress: 'In progress', unlocked: 'Unlocked', declined: 'Not now' };

export async function coverage() {
  const counties = (await all(`SELECT county_fips, count(*)::int AS sites, min(acres) AS min_acres FROM candidates WHERE excluded IS NULL GROUP BY 1 ORDER BY 2 DESC`))
    .map((r) => { const c = countyOf(r.county_fips); return { fips: r.county_fips, name: c ? `${c.name}, ${c.state}` : r.county_fips, sites: r.sites, minAcres: Math.floor(r.min_acres ?? 0) }; });
  const places = await all(`SELECT county_fips, COALESCE(city, '') AS city, count(*)::int AS sites,
      count(*) FILTER (WHERE sports_verdict <> 'unknown')::int AS zoned
    FROM candidates WHERE excluded IS NULL GROUP BY 1, 2 ORDER BY 3 DESC`);
  const meta = await one("SELECT imported_at FROM dataset_meta WHERE name = 'candidates'");
  return {
    counties, asOf: meta?.imported_at ?? null,
    places: places.map((p) => ({ place: p.city || `Unincorporated ${countyOf(p.county_fips)?.name ?? ''}`.trim(), city: p.city || null, sites: p.sites, zoned: p.zoned })),
  };
}

export async function listRequests(orgUid, projectId = null) {
  const rows = await all(`SELECT request_uid, kind, area, use_text, notes, status, project_id, requested_by_name, county_fips, created_at, updated_at
    FROM area_requests WHERE org_uid IS NOT DISTINCT FROM ? ${projectId ? 'AND project_id = ?' : ''} ORDER BY created_at DESC LIMIT 100`,
  projectId ? [orgUid ?? null, Number(projectId)] : [orgUid ?? null]);
  // A place request whose county Paydirt can now load is ready: the person can unlock it themselves.
  return rows.map((r) => {
    const fips = r.county_fips ?? fipsForCounty(r.area);
    const ready = r.status === 'requested' && r.kind !== 'zoning' && fips && isLoadable(fips);
    return { ...r, county_fips: fips, ready: Boolean(ready), place: r.area.replace(/\s*\(.*\)\s*$/, '') };
  });
}

// Unlocking a county closes the organization's open requests for it.
export async function closeRequestsFor(orgUid, fips) {
  await run(`UPDATE area_requests SET status = 'unlocked', updated_at = now() WHERE org_uid = ? AND status IN ('requested', 'in_progress')
    AND kind <> 'zoning' AND (county_fips = ? OR (county_fips IS NULL AND area ILIKE ?))`, [orgUid, fips, `%${countyOf(fips)?.name ?? '§'}%`]);
}

export async function requestArea(user, clerkUserId, { kind, area, useText, notes, projectId, countyFips } = {}) {
  area = String(area ?? '').trim();
  if (!area) throw httpError(400, 'Name the area: a county, city or neighborhood.');
  if (area.length > 200) throw httpError(400, 'Keep the area name under 200 characters.');
  kind = AREA_KINDS[kind] ? kind : 'city';
  useText = String(useText ?? '').trim().slice(0, 300) || null;
  notes = String(notes ?? '').trim().slice(0, 4000) || null;
  projectId = Number(projectId) || null;
  const message = [`Area request: ${area}`, `What: ${AREA_KINDS[kind]}`, useText && `For: ${useText}`, notes && `Notes: ${notes}`].filter(Boolean).join('\n');
  // Logged as feedback too, so it reaches the Notion review table with who asked and when.
  const fb = await logFeedback(user, clerkUserId, { message, kind: 'area', page: 'areas.html' });
  const name = (await one('SELECT name FROM feedback WHERE feedback_uid = ?', [fb.id]))?.name ?? null;
  const uid = newId('area');
  const fips = /^\d{5}$/.test(String(countyFips ?? '')) ? String(countyFips) : fipsForCounty(area);
  await one(`INSERT INTO area_requests (request_uid, org_uid, user_uid, requested_by_name, kind, area, use_text, notes, project_id, feedback_uid, county_fips)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING request_uid`,
  [uid, user?.orgUid ?? null, user?.uid ?? null, name, kind, area, useText, notes, projectId, fb.id, fips]);
  return { id: uid, sentToNotion: fb.sentToNotion };
}
