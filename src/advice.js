import { one } from './db.js';
import { previewCount } from './projects.js';
import { CHIPS } from './chips.js';

// Guidance for a project before it is created: how many sites match today, which filter cuts the most when few
// match, and whether each town the person named is loaded. Counted from the data we hold; nothing is guessed.
const FEW = 15;
const chipOf = (field) => CHIPS.find((c) => c.must.includes(field));

const BANDS = [[5, 10], [10, 15], [15, 25], [25, 50], [50, 100], [100, null]];

// areas: where the draft will search ([{ county_fips, place }]), used while a project is being set up step by step.
// bands: also count sites by size band (ignoring the size filter), for the "how much land" step.
export async function draftAdvice(spec, { areas = [], bands = false } = {}) {
  const reqs = spec?.requirements ?? [];
  const none = { id: 0, areas: (Array.isArray(areas) ? areas : []).slice(0, 20).map((a) => ({ county_fips: a?.county_fips ? String(a.county_fips) : null, place: a?.place ? String(a.place).slice(0, 60) : null })) };
  const count = await previewCount(none, spec);
  const names = reqs.find((r) => r.field === 'area')?.value ?? [];
  const places = [];
  for (const name of names.slice(0, 12)) {
    const n = (await one("SELECT count(*)::int AS n FROM candidates WHERE excluded IS NULL AND (COALESCE(city, '') ILIKE ? OR COALESCE(postal_city, '') ILIKE ?)", [`%${name}%`, `%${name}%`])).n;
    places.push({ name, sites: n, loaded: n > 0 });
  }
  // When few sites match, try the search without each filter in turn and report the one that frees the most.
  let loosen = null;
  if (count < FEW) {
    for (const r of reqs) {
      if (r.field === 'area') continue; // where to look is the person's call, not something to relax
      const without = await previewCount(none, { ...spec, requirements: reqs.filter((x) => x !== r) });
      if (without > count && (!loosen || without > loosen.count)) loosen = { key: chipOf(r.field)?.key ?? null, label: chipOf(r.field)?.label ?? r.field, count: without };
    }
  }
  let sizeBands = null;
  if (bands) {
    const rest = reqs.filter((r) => r.field !== 'acres');
    sizeBands = [];
    // Bands are half-open (10 up to 15), so a site is counted once.
    for (const [lo, hi] of BANDS) sizeBands.push({ lo, hi, count: await previewCount(none, { ...spec, requirements: [...rest, { field: 'acres', value: [lo, hi == null ? null : hi - 0.0001] }] }) });
  }
  return { count, few: count < FEW, places, loosen, bands: sizeBands };
}
