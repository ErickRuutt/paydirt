import { all } from './db.js';

// Straight-line reach from a parcel to block-group interior points. A stand-in for drive time
// until a Mapbox isochrone layer is added; at Eastside speeds, 10 miles is roughly 20 minutes.
// Cached for a minute so a re-import shows up without restarting the server.
let cache = null, cachedAt = 0;
async function blockGroups() {
  if (!cache || Date.now() - cachedAt > 60_000) {
    cache = await all('SELECT geoid, lat, lng, population, households, hh_200k_plus, median_income, hh_with_kids FROM block_groups WHERE acs_year IS NOT NULL');
    cachedAt = Date.now();
  }
  return cache;
}
export const hasDemographics = async () => (await blockGroups()).length > 0;

const R_MILES = 3958.8;
function miles(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.sqrt(a));
}

export async function reachFor(lat, lng, radii) {
  if (lat == null || lng == null || !(await hasDemographics())) return null;
  const sorted = [...radii].sort((a, b) => a - b);
  return aggregate(await blockGroups(), sorted, (bg) => {
    const d = miles(lat, lng, bg.lat, bg.lng);
    return sorted.filter((r) => d <= r);
  });
}

// Same totals, counting block groups whose interior point falls inside each drive-time area.
// areas: { minutes: GeoJSON geometry }.
export async function reachWithin(areas, pointInGeometry) {
  const keys = Object.keys(areas ?? {});
  if (!keys.length || !(await hasDemographics())) return null;
  return aggregate(await blockGroups(), keys, (bg) => keys.filter((k) => pointInGeometry(bg.lng, bg.lat, areas[k])));
}

function aggregate(groups, keys, keysContaining) {
  const out = Object.fromEntries(keys.map((r) => [r, { blockGroups: 0, population: 0, households: 0, hh200k: 0, hhWithKids: 0, incomeWeighted: 0, incomeHouseholds: 0 }]));
  for (const bg of groups) {
    for (const r of keysContaining(bg)) {
      const o = out[r];
      o.blockGroups++;
      o.population += bg.population ?? 0;
      o.households += bg.households ?? 0;
      o.hh200k += bg.hh_200k_plus ?? 0;
      o.hhWithKids += bg.hh_with_kids ?? 0;
      if (bg.median_income != null && bg.households) { o.incomeWeighted += bg.median_income * bg.households; o.incomeHouseholds += bg.households; }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([r, o]) => [r, {
    blockGroups: o.blockGroups,
    population: o.population,
    households: o.households,
    hh200k: o.hh200k,
    share200k: o.households ? o.hh200k / o.households : null,
    hhWithKids: o.hhWithKids,
    shareWithKids: o.households ? o.hhWithKids / o.households : null,
    // Household-weighted average of block-group medians: an approximation, not a true median.
    medianIncomeApprox: o.incomeHouseholds ? Math.round(o.incomeWeighted / o.incomeHouseholds) : null,
  }]));
}

export async function blockGroupsGeoJSON() {
  const rows = await all('SELECT * FROM block_groups');
  return {
    type: 'FeatureCollection',
    features: rows.map((b) => ({
      type: 'Feature',
      id: b.geoid,
      geometry: JSON.parse(b.geometry_json),
      properties: {
        geoid: b.geoid,
        households: b.households,
        hh200k: b.hh_200k_plus,
        share200k: b.households ? b.hh_200k_plus / b.households : null,
        medianIncome: b.median_income,
        shareWithKids: b.households ? b.hh_with_kids / b.households : null,
        hasData: b.acs_year != null,
      },
    })),
  };
}
