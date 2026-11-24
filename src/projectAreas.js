import { all, one, run } from './db.js';
import { newId } from './ids.js';
import { countyOf, isLoadable } from './counties.js';

// A project's search areas: the places it looks in. Each is a county, optionally narrowed to a town in it.
// This is the only place a project keeps "where"; the Where criterion shows this list and adds
// city / unincorporated. A project with no areas searches everything Paydirt holds.

const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const countyOnly = (name) => String(name ?? '').replace(/,\s*[A-Z]{2}$/, '');
export const areaLabel = (a) => (a.place ? titleCase(a.place) : countyOnly(a.county_name) || 'Unknown area');

const COLS = 'area_uid, project_id, county_fips, county_name, place, created_at';
export const areasOf = (projectId) => all(`SELECT ${COLS} FROM project_areas WHERE project_id = ? ORDER BY created_at`, [Number(projectId)]);
export async function areasOfMany(projectIds) {
  const by = new Map(projectIds.map((id) => [id, []]));
  if (projectIds.length) for (const a of await all(`SELECT ${COLS} FROM project_areas WHERE project_id = ANY(?) ORDER BY created_at`, [projectIds])) by.get(a.project_id)?.push(a);
  return by;
}

// SQL over `candidates c` for "inside any of these areas", or null when the project has none.
const PLACE_SQL = "(COALESCE(c.city, '') ILIKE ? OR COALESCE(c.postal_city, '') ILIKE ?)";
export function areaFilter(areas) {
  if (!areas?.length) return null;
  const parts = [], params = [];
  for (const a of areas) {
    const p = [];
    if (a.county_fips) { p.push('c.county_fips = ?'); params.push(a.county_fips); }
    if (a.place) { p.push(PLACE_SQL); params.push(`%${a.place}%`, `%${a.place}%`); }
    if (p.length) parts.push(`(${p.join(' AND ')})`);
  }
  return parts.length ? { sql: `(${parts.join(' OR ')})`, params } : null;
}
// The same test for one candidates row.
export function inAreas(areas, c) {
  if (!areas?.length) return true;
  const towns = `${c.city ?? ''} ${c.postal_city ?? ''}`.toLowerCase();
  return areas.some((a) => (!a.county_fips || a.county_fips === c.county_fips) && (!a.place || towns.includes(a.place.toLowerCase())));
}

// Each area with how many sites Paydirt holds in it and whether this organization can search it yet.
export async function listAreas(project) {
  const out = [];
  for (const a of await areasOf(project.id)) {
    const f = areaFilter([a]);
    const sites = f ? (await one(`SELECT count(*)::int AS n FROM candidates c WHERE c.excluded IS NULL AND ${f.sql}`, f.params)).n : 0;
    const c = a.county_fips ? countyOf(a.county_fips) : null;
    const owned = a.county_fips && (c?.loadedByScript || await one("SELECT 1 FROM county_unlocks WHERE org_uid = ? AND county_fips = ? AND status = 'done' LIMIT 1", [project.org_uid, a.county_fips]));
    // loaded: searchable now. ready: Paydirt can load the county on its own. on_request: no source connected yet.
    const state = sites > 0 && owned ? 'loaded' : a.county_fips && isLoadable(a.county_fips) ? (owned ? 'empty' : 'ready') : 'on_request';
    out.push({ ...a, label: areaLabel(a), sites, state });
  }
  return out;
}

export async function addArea(project, { fips, countyName, place }, user) {
  const town = String(place ?? '').trim().slice(0, 120) || null;
  // A place named after its county ("Jefferson County") means the whole county.
  const whole = !town || (countyName && town.toLowerCase() === countyOnly(countyName).toLowerCase());
  await run(`INSERT INTO project_areas (area_uid, project_id, county_fips, county_name, place, added_by) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`, [newId('par'), project.id, fips ?? null, countyName ?? null, whole ? null : town, user?.uid ?? null]);
  // Searching the whole county replaces towns in it; a town is pointless once the whole county is in.
  if (whole && fips) await run('DELETE FROM project_areas WHERE project_id = ? AND county_fips = ? AND place IS NOT NULL', [project.id, fips]);
  return areasOf(project.id);
}

export async function removeArea(project, areaUid) {
  await run('DELETE FROM project_areas WHERE project_id = ? AND area_uid = ?', [project.id, String(areaUid)]);
  return areasOf(project.id);
}

// Town names (from a brief, or an older project's Where criterion) → areas. A name Paydirt already holds parcels for
// goes to the county (or counties) it is in; any other name is looked up; one that can't be placed is kept by name.
export async function placeAreas(project, names, user, resolve) {
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim(); if (!name) continue;
    const held = await all(`SELECT DISTINCT c.county_fips FROM candidates c WHERE c.county_fips IS NOT NULL AND ${PLACE_SQL}`, [`%${name}%`, `%${name}%`]);
    if (held.length) {
      for (const h of held) { const c = countyOf(h.county_fips); await addArea(project, { fips: h.county_fips, countyName: c ? `${c.name}, ${c.state}` : null, place: name }, user); }
      continue;
    }
    let p = null;
    try { p = await resolve?.(name); } catch { /* not found, or the lookup is down: keep the name */ }
    await addArea(project, p ? { fips: p.fips, countyName: `${p.county}, ${p.state}`, place: p.place } : { place: name }, user);
  }
}
