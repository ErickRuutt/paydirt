import { ownerType, CORPORATE_MAIL } from './tenants.js';
import { townsFor, townOf } from './towns.js';

// Counties Paydirt can load, keyed by FIPS. Each one names its free public parcel layer (an ArcGIS
// MapServer/FeatureServer layer), the field that holds acres, and — when an adapter exists — how to turn
// its records into `candidates` rows. Counting parcels for a quote is free (returnCountOnly).
// King County is loaded by scripts/import-candidates.js (assessor extracts + sales history), not here.

const KING_LAYER = 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/2';
const PIERCE_LAYER = 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/ArcGIS/rest/services/Tax_Parcels/FeatureServer/0';
const CLALLAM_LAYER = 'https://websrv31.clallamcountywa.gov/server/rest/services/Parcels_Published/MapServer/1';

export const COUNTIES = {
  53033: { fips: '53033', name: 'King County', state: 'WA', layer: KING_LAYER, loadedByScript: true,
    includes: 'address, owner signals, zoning verdicts, assessed values, sales history and current use', where: (min) => `KCA_ACRES >= ${Number(min)}`,
    sources: { parcels: { label: 'King County GIS parcels', url: 'https://gismaps.kingcounty.gov/' }, assessor: { label: 'King County Assessor', url: 'https://info.kingcounty.gov/assessor/esales/Parcel.aspx' } } },
  53009: { fips: '53009', name: 'Clallam County', state: 'WA', layer: CLALLAM_LAYER, load: loadClallam,
    includes: 'owner, zoning code, assessed values, last deed date and site address where one exists',
    // Quotes count only parcels with assessed value: roads, national forest and water carry none.
    where: (min) => `ACRES_GIS >= ${Number(min)} AND (VALUE_LAND > 0 OR VALUE_IMPR > 0)`,
    sources: { parcels: { label: 'Clallam County GIS parcels', url: CLALLAM_LAYER }, assessor: { label: 'Clallam County Assessor', url: 'https://www.clallamcountywa.gov/279/Assessor' } } },
  53053: { fips: '53053', name: 'Pierce County', state: 'WA', layer: PIERCE_LAYER, load: loadPierce, townsFromCensus: true,
    includes: 'site address, assessed values, land use, tax exemptions and the owner\'s mailing city (no owner names or zoning yet)',
    where: (min) => `Land_Acres >= ${Number(min)} AND (Land_Value > 0 OR Improvement_Value > 0)`,
    sources: { parcels: { label: 'Pierce County tax parcels', url: PIERCE_LAYER }, assessor: { label: 'Pierce County Assessor-Treasurer', url: 'https://atip.piercecountywa.gov/' } } },
};

// ---------- Every other Washington county: the state's own statewide parcel layer ----------
// One schema for all 39 counties (parcel ID, site address, land use, values, shapes), updated April 2026.
// It has no acres field (computed from the shape), no owner and no zoning; towns come from Census boundaries.
const WA_LAYER = 'https://services.arcgis.com/jsIt88o09Q0r1j8h/ArcGIS/rest/services/Current_Parcels/FeatureServer/0';
const WA_NAMES = { '001': 'Adams', '003': 'Asotin', '005': 'Benton', '007': 'Chelan', '009': 'Clallam', '011': 'Clark', '013': 'Columbia', '015': 'Cowlitz',
  '017': 'Douglas', '019': 'Ferry', '021': 'Franklin', '023': 'Garfield', '025': 'Grant', '027': 'Grays Harbor', '029': 'Island', '031': 'Jefferson',
  '033': 'King', '035': 'Kitsap', '037': 'Kittitas', '039': 'Klickitat', '041': 'Lewis', '043': 'Lincoln', '045': 'Mason', '047': 'Okanogan',
  '049': 'Pacific', '051': 'Pend Oreille', '053': 'Pierce', '055': 'San Juan', '057': 'Skagit', '059': 'Skamania', '061': 'Snohomish',
  '063': 'Spokane', '065': 'Stevens', '067': 'Thurston', '069': 'Wahkiakum', '071': 'Walla Walla', '073': 'Whatcom', '075': 'Whitman', '077': 'Yakima' };
// The layer is in Washington State Plane (US feet), so its shape area is square feet: 43,560 per acre. Counts
// allow 2% for projection error; loads keep only parcels whose real (geodesic) area qualifies.
const SQFT_PER_ACRE = 43560;
function statewide(fips) {
  const code = String(fips).slice(2), name = WA_NAMES[code];
  if (!String(fips).startsWith('53') || !name) return null;
  return { fips: String(fips), name: `${name} County`, state: 'WA', layer: WA_LAYER, townsFromCensus: true,
    includes: 'site address, assessed values and land use (no owner names or zoning yet)',
    where: (min) => `FIPS_NR = '${code}' AND Shape__Area >= ${Math.floor(Number(min) * SQFT_PER_ACRE * 0.98)} AND (VALUE_LAND > 0 OR VALUE_BLDG > 0)`,
    load: (min) => loadStatewide(code, `${name} County`, min),
    sources: { parcels: { label: 'Washington statewide parcels (2026)', url: 'https://geo.wa.gov/' }, assessor: { label: `${name} County Assessor`, url: null } } };
}

export const countyOf = (fips) => COUNTIES[fips] ?? statewide(fips);
// Can Paydirt load (or has it loaded) this county without anyone building anything?
export const isLoadable = (fips) => { const c = countyOf(fips); return Boolean(c?.load || c?.loadedByScript); };
// "Pierce County, WA" → '53053' (Washington only; other states have no source yet).
export function fipsForCounty(text) {
  const m = String(text ?? '').match(/([A-Za-z .'-]+?) County,\s*WA\b/i);
  if (!m) return null;
  const code = Object.entries(WA_NAMES).find(([, n]) => n.toLowerCase() === m[1].trim().toLowerCase())?.[0];
  return code ? `53${code}` : null;
}

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
  const c = countyOf(fips);
  if (!c) return null;
  return (await arcgis(c.layer, { where: c.where(minAcres), returnCountOnly: 'true' })).count;
}

// Page through a layer's matches (2,000 at most per page on these services).
async function fetchAll(layer, params) {
  const feats = [];
  for (let offset = 0; ; offset += 2000) {
    const j = await arcgis(layer, { ...params, orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000',
      outSR: '4326', maxAllowableOffset: '0.00005', geometryPrecision: '6', returnGeometry: 'true' });
    feats.push(...j.features);
    if (j.features.length < 2000 && !j.exceededTransferLimit) break;
  }
  return feats;
}

// Real (not projected) area of WGS84 rings in acres: spherical excess, good to well under 1% at parcel scale.
function acresOf(rings) {
  const R = 6378137, k = Math.PI / 180;
  let total = 0;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += (r[i + 1][0] - r[i][0]) * k * (2 + Math.sin(r[i][1] * k) + Math.sin(r[i + 1][1] * k));
    total += a; // rings wind opposite ways for holes, so the signed sum subtracts them
  }
  return Math.abs((total * R * R) / 2) / 4046.86;
}

// Washington Department of Revenue land use codes (first two digits), in plain words.
const DOR_USE = { 11: 'Single-family residence', 12: 'Multi-unit residence', 13: 'Residence, 3+ units', 14: 'Residential condominium', 18: 'Other residential',
  19: 'Vacation or cabin', 21: 'Food manufacturing', 50: 'Retail trade', 53: 'Retail trade', 55: 'Auto dealer or service', 58: 'Eating and drinking',
  61: 'Finance or real estate', 62: 'Personal services', 63: 'Business services', 65: 'Professional services', 67: 'Government services',
  68: 'Educational services', 69: 'Miscellaneous services', 71: 'Cultural', 72: 'Public assembly', 74: 'Recreational', 75: 'Resort or group camp',
  76: 'Park', 81: 'Agriculture', 82: 'Agriculture-related', 83: 'Agriculture (current use)', 84: 'Fishing', 85: 'Mining', 88: 'Designated forest land',
  89: 'Other resource production', 91: 'Undeveloped land', 92: 'Noncommercial forest', 93: 'Water area', 94: 'Open space (current use)',
  95: 'Timberland (current use)', 99: 'Other undeveloped land' };
const CURRENT_USE_CODES = { 83: 'Agriculture', 88: 'Designated forest land', 94: 'Open space', 95: 'Timber' };
const PUBLIC_USE_CODES = new Set([67, 68, 76, 93]);
const useCode = (v) => { const n = Number(String(v ?? '').slice(0, 2)); return Number.isFinite(n) && n > 0 ? n : null; };

// Shared row shape for county loads that only know values, use and shape (no owner name, sales or zoning).
function basicRow({ pin, address, geometry, acres, land, impr, use, town, zip, mailCityState = null, mailAddress = null, zoningSource = null, county }) {
  const [lng, lat] = centroid(geometry) ?? [null, null];
  const imprPerAcre = impr != null && acres ? impr / acres : null;
  const code = useCode(use);
  const signals = [];
  if (imprPerAcre != null && imprPerAcre < 10000) signals.push('mostly land value (little or no building)');
  const cu = CURRENT_USE_CODES[code] ?? null;
  if (cu) signals.push(`in ${cu.toLowerCase()} tax program`);
  const ownState = mailCityState?.match(/,?\s*([A-Z]{2})$/)?.[1] ?? null, ownCity = mailCityState?.replace(/,?\s*[A-Z]{2}$/, '').trim().toUpperCase() || null;
  const outOfState = ownState ? ownState !== 'WA' : null;
  const absentee = ownCity && town.postal ? ownCity !== town.postal : null;
  if (outOfState) signals.push('owner mails from out of state');
  else if (absentee) signals.push('owner mails from another city');
  let excluded = null;
  if (!land && !impr) excluded = 'no assessed value (public land, roads or water)';
  else if (PUBLIC_USE_CODES.has(code)) excluded = `public or institutional use (${DOR_USE[code]})`;
  return {
    pin, address: address || null, city: town.city, postal_city: town.postal, zip: zip || null, acres, zoning: null,
    sports_verdict: 'unknown', sports_note: `${county} zoning has not been read for this use yet.`, zoning_source: zoningSource,
    present_use: DOR_USE[code] ?? (use ? String(use) : null), land_value: land, impr_value: impr, mail_address: mailAddress, mail_city_state: mailCityState,
    absentee, out_of_state: outOfState, lat, lng, geometry_json: geometry ? JSON.stringify({ type: 'Polygon', coordinates: geometry.rings }) : null,
    years_held: null, years_since_transfer: null, signals: JSON.stringify(signals), excluded,
    tags: JSON.stringify((imprPerAcre ?? 0) < 5000 ? ['vacant-land'] : []), businesses: '[]', owner_type: null, current_use: cu,
  };
}

async function loadStatewide(code, county, minAcres) {
  const [feats, towns] = await Promise.all([
    fetchAll(WA_LAYER, { where: statewide(`53${code}`).where(minAcres), outFields: 'OBJECTID,PARCEL_ID_NR,SITUS_ADDRESS,SITUS_ZIP_NR,LANDUSE_CD,VALUE_LAND,VALUE_BLDG,DATA_LINK' }),
    townsFor('53'),
  ]);
  const rows = [], seen = new Set();
  for (const f of feats) {
    const a = f.attributes, pin = String(a.PARCEL_ID_NR ?? '').trim();
    if (!pin || seen.has(pin) || !f.geometry) continue;
    const acres = acresOf(f.geometry.rings);
    if (acres < minAcres) continue; // the server filter is approximate; this one is exact
    seen.add(pin);
    const [lng, lat] = centroid(f.geometry) ?? [];
    rows.push(basicRow({ pin, address: a.SITUS_ADDRESS, geometry: f.geometry, acres, land: a.VALUE_LAND, impr: a.VALUE_BLDG, use: a.LANDUSE_CD,
      town: townOf(towns, lng, lat), zip: a.SITUS_ZIP_NR, county }));
  }
  return { rows, source: `wa_statewide_${code}`, sourceLabel: `Washington statewide parcels, ${county}, ${minAcres}+ acres` };
}

// ---------- Pierce County adapter ----------
// The county's tax parcel layer: acres, values, site address, land use, exemptions, and the tax bill's mailing
// city (no owner name). City_State and Zipcode are the owner's mailing address, not the site's.
async function loadPierce(minAcres) {
  const [feats, towns] = await Promise.all([
    fetchAll(PIERCE_LAYER, { where: COUNTIES[53053].where(minAcres),
      outFields: 'OBJECTID,TaxParcelNumber,TaxParcelType,Site_Address,Delivery_Address,City_State,Land_Acres,Land_Value,Improvement_Value,Use_Code,Exemption_Code,Latitude,Longitude' }),
    townsFor('53'),
  ]);
  const rows = [], seen = new Set();
  for (const f of feats) {
    const a = f.attributes, pin = String(a.TaxParcelNumber ?? '').trim();
    if (!pin || seen.has(pin) || !f.geometry) continue;
    seen.add(pin);
    const row = basicRow({ pin, address: a.Site_Address, geometry: f.geometry, acres: a.Land_Acres, land: a.Land_Value, impr: a.Improvement_Value, use: a.Use_Code,
      town: townOf(towns, a.Longitude, a.Latitude), mailCityState: a.City_State?.trim() || null, mailAddress: a.Delivery_Address?.trim() || null,
      zoningSource: null, county: 'Pierce County' });
    if (!row.excluded && a.Exemption_Code && /^EX/i.test(a.Exemption_Code)) row.excluded = 'tax exempt (public, tribal or nonprofit)';
    rows.push(row);
  }
  return { rows, source: 'pierce_assessor', sourceLabel: `Pierce County tax parcels ${minAcres}+ acres` };
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
