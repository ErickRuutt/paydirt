import { all, pool } from './db.js';
import { fetchAll } from './counties.js';
import { inside } from './towns.js';

// Zone codes for every parcel, free, from the zoning maps counties and cities publish. Each entry is one map:
// the county's covers unincorporated land only (inside a city it just says which city), so a city needs its own.
// A zone code says which rules apply; whether a use is allowed there comes from reading the code (src/zoningReader.js).
export const ZONE_LAYERS = [
  { fips: '53053', city: null, place: 'Pierce County', code: 'ZON_CUR_CD', name: 'ZON_CUR_NA',
    url: 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Zoning_and_Land_Use_Designations/FeatureServer/0' },
  { fips: '53053', city: 'GIG HARBOR', place: 'Gig Harbor', code: 'ZoneCode', name: 'ZoneDescription',
    url: 'https://services3.arcgis.com/FjNT4j1knnY5Wsw5/arcgis/rest/services/Zoning_Public_Viewer/FeatureServer/0' },
  // Tacoma's full code carries overlay suffixes (UR3-STGPD); the base zone is the one the use table is keyed by.
  { fips: '53053', city: 'TACOMA', place: 'Tacoma', code: 'BaseZone', name: null,
    url: 'https://services3.arcgis.com/SCwJH1pD8WSn5T5y/arcgis/rest/services/Zoning_Districts/FeatureServer/0' },
];

export const jurisdictionKey = (fips, city) => `${fips}:${city ?? ''}`;
export const SPORTS_USE = 'sports_facility';
export const layersFor = (fips) => ZONE_LAYERS.filter((l) => l.fips === String(fips));
export const hasZoneLayer = (fips, city) => ZONE_LAYERS.some((l) => l.fips === String(fips) && l.city === (city ?? null));

function shapeOf(f, l) {
  const rings = f.geometry?.rings ?? [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { code: String(f.attributes[l.code] ?? '').trim(), name: l.name ? String(f.attributes[l.name] ?? '').trim() || null : null, rings, box: [minX, minY, maxX, maxY] };
}

// Stamp the zone on every parcel of a county that sits on one of its zoning maps (by the parcel's centre point).
// Safe to re-run. Returns how many parcels now carry a zone, per map.
export async function fillZones(fips) {
  const out = [];
  for (const l of layersFor(fips)) {
    const shapes = (await fetchAll(l.url, { where: '1=1', outFields: `OBJECTID,${[l.code, l.name].filter(Boolean).join(',')}` })).map((f) => shapeOf(f, l)).filter((s) => s.code && s.rings.length);
    const rows = await all('SELECT pin, lat, lng FROM candidates WHERE county_fips = ? AND city IS NOT DISTINCT FROM ? AND lat IS NOT NULL AND lng IS NOT NULL', [l.fips, l.city]);
    const pins = [], codes = [], names = [];
    for (const r of rows) {
      const s = shapes.find((p) => inside(r.lng, r.lat, p));
      if (s) { pins.push(r.pin); codes.push(s.code); names.push(s.name); }
    }
    if (pins.length) {
      await pool.query(`UPDATE candidates c SET zoning = v.code, zone_name = v.name, updated_at = now()
        FROM unnest($1::text[], $2::text[], $3::text[]) AS v(pin, code, name) WHERE c.pin = v.pin AND c.county_fips = $4`, [pins, codes, names, l.fips]);
      // Parcels with no verdict yet say what is and isn't known; ones already read keep their verdict.
      await pool.query(`UPDATE candidates SET sports_note = $3 WHERE county_fips = $1 AND city IS NOT DISTINCT FROM $2 AND sports_verdict = 'unknown' AND zoning_basis IS NULL AND zoning IS NOT NULL`,
        [l.fips, l.city, `${l.place}'s rules for this use have not been read yet.`]);
    }
    await applyVerdicts(l.fips, l.city);
    out.push({ place: l.place, parcels: rows.length, zoned: pins.length });
  }
  return out;
}

// Copy the stored verdicts for one jurisdiction onto its parcels.
export async function applyVerdicts(fips, city, q = pool) {
  const r = await q.query(`UPDATE candidates c SET sports_verdict = r.verdict, sports_note = r.notes, zoning_source = r.source_url, zoning_basis = r.basis, updated_at = now()
    FROM zoning_rules r WHERE r.jurisdiction = $1 AND r.use = $2 AND upper(r.zone) = upper(c.zoning) AND c.county_fips = $3 AND c.city IS NOT DISTINCT FROM $4`,
  [jurisdictionKey(fips, city), SPORTS_USE, String(fips), city ?? null]);
  return r.rowCount;
}
