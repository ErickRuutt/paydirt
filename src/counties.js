import { ownerType, CORPORATE_MAIL } from './tenants.js';

// Counties Paydirt can load, keyed by FIPS. Each one names its free public parcel layer (an ArcGIS
// MapServer/FeatureServer layer), the field that holds acres, and — when an adapter exists — how to turn
// its records into `candidates` rows. Counting parcels for a quote is free (returnCountOnly).
// King County is loaded by scripts/import-candidates.js (assessor extracts + sales history), not here.

const KING_LAYER = 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2';
const CLALLAM_LAYER = 'https://websrv31.clallamcountywa.gov/server/rest/services/Parcels_Published/MapServer/1';

export const COUNTIES = {
  53033: { fips: '53033', name: 'King County', state: 'WA', layer: KING_LAYER, acresField: 'KCA_ACRES', loadedByScript: true,
    sources: { parcels: { label: 'King County GIS parcels', url: 'https://gismaps.kingcounty.gov/' }, assessor: { label: 'King County Assessor', url: 'https://info.kingcounty.gov/assessor/esales/Parcel.aspx' } } },
  53009: { fips: '53009', name: 'Clallam County', state: 'WA', layer: CLALLAM_LAYER, acresField: 'ACRES_GIS', load: loadClallam,
    // Quotes count only parcels with assessed value: roads, national forest and water carry none.
    countWhere: '(VALUE_LAND > 0 OR VALUE_IMPR > 0)',
    sources: { parcels: { label: 'Clallam County GIS parcels', url: CLALLAM_LAYER }, assessor: { label: 'Clallam County Assessor', url: 'https://www.clallamcountywa.gov/279/Assessor' } } },
};
export const countyOf = (fips) => COUNTIES[fips] ?? null;

async function arcgis(layer, params) {
  const url = `${layer}/query?${new URLSearchParams({ f: 'json', ...params })}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const j = await (await fetch(url, { signal: AbortSignal.timeout(90_000) })).json();
      if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
      return j;
    } catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
}

export async function countParcels(fips, minAcres) {
  const c = COUNTIES[fips];
  if (!c) return null;
  const j = await arcgis(c.layer, { where: `${c.acresField} >= ${Number(minAcres)}${c.countWhere ? ` AND ${c.countWhere}` : ''}`, returnCountOnly: 'true' });
  return j.count;
}

// ---------- Clallam County adapter ----------
// Public layer with owner, zoning (and the code link), land/improvement values, water and flood flags.
// No sales history or situs address in it: years held comes from the date of the last recorded deed.
const CLALLAM_ZIPS = { 98382: 'SEQUIM', 98362: 'PORT ANGELES', 98363: 'PORT ANGELES', 98331: 'FORKS', 98324: 'CARLSBORG', 98343: 'JOYCE',
  98326: 'CLALLAM BAY', 98381: 'SEKIU', 98305: 'BEAVER', 98357: 'NEAH BAY' };
const CLALLAM_FIELDS = 'GEO_12,ACRES_GIS,VALUE_LAND,VALUE_IMPR,LUDESC_RES,LUDESC_OTH,ZONING,CITY,ZIP_CODE,OWN_LAST,OWN_FIRST,OWN_ADDR1,OWN_CITY,OWN_STATE,MDOC_DATE,zoning_url,FLOOD_ZONE,UGA,OBJECTID';
const PUBLIC_OWNER = /\b(STATE OF|DEPT OF|DEPARTMENT OF|UNITED STATES|USA\b|COUNTY|CITY OF|PORT OF|SCHOOL DIST|PUD\b|TRIBE|TRIBAL|NATIONAL PARK|FOREST SERVICE|PARKS)\b/i;

function centroid(geom) {
  const rings = geom?.rings ?? [];
  let best = null, bestA = 0;
  for (const r of rings) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; }
  }
  return best;
}

async function loadClallam(minAcres) {
  const c = COUNTIES[53009];
  const feats = [];
  for (let offset = 0; ; offset += 1000) {
    const j = await arcgis(c.layer, { where: `ACRES_GIS >= ${Number(minAcres)} AND GEO_12 IS NOT NULL`, outFields: CLALLAM_FIELDS, orderByFields: 'OBJECTID',
      resultOffset: String(offset), resultRecordCount: '1000', outSR: '4326', maxAllowableOffset: '0.00005', geometryPrecision: '6', returnGeometry: 'true' });
    feats.push(...j.features);
    if (j.features.length < 1000 && !j.exceededTransferLimit) break;
  }
  const now = Date.now();
  const rows = [];
  const seen = new Set();
  for (const f of feats) {
    const a = f.attributes;
    const pin = String(a.GEO_12).trim();
    if (!pin || seen.has(pin)) continue; // stacked parcels (condos) repeat the number
    seen.add(pin);
    const [lng, lat] = centroid(f.geometry) ?? [null, null];
    const city = a.CITY?.trim() ? a.CITY.trim().toUpperCase() : null;
    const postal = CLALLAM_ZIPS[a.ZIP_CODE] ?? null;
    const owner = [a.OWN_LAST, a.OWN_FIRST].filter(Boolean).join(' ').trim() || null;
    const land = a.VALUE_LAND ?? null, impr = a.VALUE_IMPR ?? null, acres = a.ACRES_GIS;
    const imprPerAcre = impr != null && acres ? impr / acres : null;
    const ownState = a.OWN_STATE?.trim() || null, ownCity = a.OWN_CITY?.trim().toUpperCase() || null;
    const outOfState = ownState ? ownState !== 'WA' : null;
    const absentee = ownCity && (postal || city) ? ownCity !== (city ?? postal) : null;
    const yearsHeld = a.MDOC_DATE ? Math.round(((now - a.MDOC_DATE) / 3.15576e10) * 10) / 10 : null;
    const use = (a.LUDESC_RES || a.LUDESC_OTH || '').trim() || null;
    const signals = [];
    if (yearsHeld == null) signals.push('no deed date on record');
    else if (yearsHeld >= 20) signals.push(`held ${Math.floor(yearsHeld)}+ years since the last recorded deed`);
    else if (yearsHeld < 3) signals.push('bought within 3 years');
    if (CORPORATE_MAIL.some((re) => re.test(`${ownCity ?? ''} ${ownState ?? ''}`))) signals.push('tax bill goes to a business');
    else if (outOfState) signals.push('owner mails from out of state');
    else if (absentee) signals.push('owner mails from another city');
    if (imprPerAcre != null && imprPerAcre < 10000) signals.push('mostly land value (little or no building)');
    const tags = [];
    if ((imprPerAcre ?? 0) < 5000) tags.push('vacant-land');
    let excluded = null;
    if (/EXMPT|EXEMPT/i.test(use ?? '') || (owner && PUBLIC_OWNER.test(owner))) excluded = 'public or tax-exempt owner';
    else if (!land && !impr) excluded = 'no assessed value (public land, roads or water)';
    rows.push({
      pin, address: null, city, postal_city: postal, zip: a.ZIP_CODE || null, acres, zoning: a.ZONING?.trim() || null,
      sports_verdict: 'unknown', sports_note: 'Clallam County zoning has not been read for this use yet.', zoning_source: a.zoning_url || null,
      present_use: use, land_value: land, impr_value: impr, mail_address: a.OWN_ADDR1 || null,
      mail_city_state: ownCity ? `${ownCity} ${ownState ?? ''}`.trim() : null, absentee, out_of_state: outOfState, lat, lng,
      geometry_json: f.geometry ? JSON.stringify({ type: 'Polygon', coordinates: f.geometry.rings }) : null,
      years_held: yearsHeld, years_since_transfer: yearsHeld, signals: JSON.stringify(signals), excluded,
      tags: JSON.stringify(tags), businesses: '[]', owner_type: owner ? ownerType(owner) : null,
    });
  }
  return { rows, source: 'clallam_assessor', sourceLabel: `Clallam County GIS parcels ${minAcres}+ acres` };
}
