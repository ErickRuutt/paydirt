// Build the candidates table: every King County parcel of 5+ acres, with the facts profiles score on.
// Facts only — zoning verdict, size, use, owner signals, $200k+ households within 10 miles.
// Scoring happens at read time from a search profile (src/profiles.js).
// Free county data only. Inputs in data/raw/:
//   gis-parcels.json            (npm run fetch:gis — boundaries, address, zoning, use, values)
//   account/EXTR_RPAcct_NoName.csv (Real Property Account.zip — mailing address, tax status)
//   parcel/EXTR_Parcel.csv      (Parcel.zip — current-use tax program)
// Needs sales and block_groups already loaded (import:sales, import:census).
// Usage: npm run import:candidates
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { connect, insertMany, setMeta, splitCsv } from './lib/pg-script.js';
import { ownershipForMany } from '../src/ownership.js';
import { pool } from '../src/db.js';
import { sportsClubVerdict } from '../src/zoning-kc.js';
import { classifyBusiness, ownerType, CORPORATE_MAIL, CORPORATE_ATTN } from '../src/tenants.js';
import { pointInGeometry } from '../src/isochrone.js';

const RAW = new URL('../data/raw/', import.meta.url).pathname;
const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));


async function* csv(file) {
  let header = null;
  for await (const line of createInterface({ input: createReadStream(file, 'latin1'), crlfDelay: Infinity })) {
    if (!line) continue;
    const f = splitCsv(line);
    if (!header) { header = Object.fromEntries(f.map((h, i) => [h, i])); continue; }
    yield (k) => f[header[k]]?.trim() ?? '';
  }
}
const pinOf = (get) => get('Major').padStart(6, '0') + get('Minor').padStart(4, '0');

// --- Inputs --------------------------------------------------------------------------------
const gis = JSON.parse(readFileSync(RAW + 'gis-parcels.json', 'utf8')).features;
const pins = new Set(gis.map((f) => f.properties.PIN));
console.log(`${gis.length.toLocaleString()} GIS parcels.`);

const accounts = new Map();
for await (const get of csv(RAW + 'account/EXTR_RPAcct_NoName.csv')) {
  const pin = pinOf(get);
  if (!pins.has(pin)) continue;
  const prev = accounts.get(pin);
  // A parcel can have several accounts; prefer the taxable one.
  if (prev && prev.taxStat === 'T') continue;
  accounts.set(pin, { attn: get('AttnLine'), addr: get('AddrLine'), cityState: get('CityState').replace(/\s+/g, ' '), zip: get('ZipCode'), taxStat: get('TaxStat') });
}
console.log(`${accounts.size.toLocaleString()} matched tax accounts.`);

const CURRENT_USE = { 1: 'Agriculture', 2: 'Timber', 3: 'Open space', 4: 'Forest land', 5: 'Designated forest land' };
const currentUse = new Map();
for await (const get of csv(RAW + 'parcel/EXTR_Parcel.csv')) {
  const pin = pinOf(get);
  const c = Number(get('CurrentUseDesignation'));
  if (pins.has(pin) && c) currentUse.set(pin, CURRENT_USE[c] ?? `Code ${c}`);
}

// Named businesses from OpenStreetMap, bucketed on a ~1 km grid for fast parcel lookups.
const pois = existsSync(RAW + 'osm-pois.json') ? JSON.parse(readFileSync(RAW + 'osm-pois.json', 'utf8')).pois : [];
const CELL = 0.01, key = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
const grid = new Map();
for (const q of pois) (grid.get(key(q.lat, q.lng)) ?? grid.set(key(q.lat, q.lng), []).get(key(q.lat, q.lng))).push(q);
console.log(`${pois.length.toLocaleString()} named businesses from OpenStreetMap.`);
function businessesIn(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const p of polys) for (const [x, y] of p[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const out = new Map();
  for (let la = Math.floor(minY / CELL); la <= Math.floor(maxY / CELL); la++) for (let ln = Math.floor(minX / CELL); ln <= Math.floor(maxX / CELL); ln++) {
    for (const q of grid.get(`${la}:${ln}`) ?? []) {
      if (q.lng < minX || q.lng > maxX || q.lat < minY || q.lat > maxY || !pointInGeometry(q.lng, q.lat, geom)) continue;
      const c = classifyBusiness(q.name, q.brand);
      const label = q.brand || q.name;
      if (!out.has(label)) out.set(label, { label, name: q.name, kind: q.kind.split(':')[1]?.replace(/_/g, ' ') ?? q.kind, status: q.disused ? 'closing' : c.status, note: q.disused ? 'marked closed or vacant in OpenStreetMap' : c.note ?? null });
    }
  }
  return [...out.values()].slice(0, 25);
}

const owners = await ownershipForMany([...pins]);
const groups = (await pool.query('SELECT lat, lng, households, hh_200k_plus, hh_with_kids FROM block_groups WHERE acs_year IS NOT NULL')).rows;
await pool.end();

// --- Helpers -------------------------------------------------------------------------------
function centroid(g) {
  // Area-weighted centroid of the largest polygon's outer ring.
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  let best = null, bestA = 0;
  for (const p of polys) {
    const r = p[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; }
  }
  return best;
}
const R = 3958.8, rad = Math.PI / 180;
const miles = (a, b, c, d) => 2 * R * Math.asin(Math.sqrt(Math.sin((c - a) * rad / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin((d - b) * rad / 2) ** 2));
function reach10(lat, lng) {
  let hh = 0, rich = 0, kids = 0;
  for (const g of groups) {
    if (Math.abs(g.lat - lat) > 0.15 || Math.abs(g.lng - lng) > 0.22) continue; // ~10 mi box first
    if (miles(lat, lng, g.lat, g.lng) > 10) continue;
    hh += g.households ?? 0; rich += g.hh_200k_plus ?? 0; kids += g.hh_with_kids ?? 0;
  }
  return { rich, share: hh ? rich / hh : null, kids: hh ? kids / hh : null };
}
// Present uses that mean a business is running on the land (assessor's own words).
const OPERATING_USE = /^(Retail|Shopping Ctr|Office|Warehouse|Industrial|Service Building|Restaurant|Hotel|Motel|Bank|Grocery|Supermarket|Auto|Service Station|Mini Warehouse|Medical|Nursing|Daycare|Health Club|Sport|Bowling|Theater|Terminal|High Tech|Distribution|Car Wash|Tavern|Fast Food|Mortuary|Club|Marina|Rehabilitation|Hospital|Conv Store|Post Office|Parking)/i;
const PUBLIC_USE = /^(Park, Public|School|Right of Way|Utility, Public|Governmental|Golf|Cemetery|Water Body|Reserve\/Wilderness|Military|Tideland|Church|Condominium|Apartment|Mobile Home Park|Open Space)/i;

// --- Score ---------------------------------------------------------------------------------
const rows = [];
for (const f of gis) {
  const p = f.properties;
  const pin = p.PIN;
  const city = p.CTYNAME ? p.CTYNAME.trim().toUpperCase() : null;
  const postal = p.POSTALCTYNAME?.trim().toUpperCase() || null;
  const use = p.PREUSE_DESC?.trim() || null;
  const acct = accounts.get(pin) ?? {};
  const own = owners.get(pin) ?? {};
  const [lng, lat] = centroid(f.geometry) ?? [null, null];
  const mkt = lat != null ? reach10(lat, lng) : { rich: null, share: null, kids: null };
  const zone = p.KCA_ZONING?.trim() || null;
  const sports = sportsClubVerdict(zone, city);
  const land = p.APPRLNDVAL ?? null, impr = p.APPR_IMPR ?? null;
  const mailState = acct.cityState?.match(/\b([A-Z]{2})$/)?.[1] ?? null;
  const mailCity = acct.cityState?.replace(/\s+[A-Z]{2}$/, '').trim() || null;
  const outOfState = mailState ? mailState !== 'WA' : null;
  const absentee = mailCity && postal ? mailCity !== postal : null;
  const cu = currentUse.get(pin) ?? null;

  // Owner signals (facts; projects turn them into points at read time).
  const signals = [...(own.signals ?? []).filter((s) => s !== 'no recorded sales')];
  const yh = own.yearsSinceMarketSale;
  const oType = ownerType(own.lastTransfer?.buyer);
  // A tax bill sent to a company HQ or a property-tax firm means a business pays it — not an absentee person.
  const corporateMail = CORPORATE_MAIL.some((re) => re.test(acct.cityState ?? '')) || CORPORATE_ATTN.test(acct.attn ?? '');
  if (corporateMail) signals.push('tax bill goes to a business');
  else if (outOfState) signals.push('owner mails from out of state');
  else if (absentee) signals.push('owner mails from another city');
  // "Little or no building" judged by building value per acre, not the building-to-land ratio:
  // expensive land made a Costco look empty.
  const imprPerAcre = impr != null && p.KCA_ACRES ? impr / p.KCA_ACRES : null;
  const businesses = businessesIn(f.geometry);
  const operatingUse = Boolean(use && OPERATING_USE.test(use));
  const liveBusinesses = businesses.filter((b) => b.status !== 'closing');
  const operating = (operatingUse && (imprPerAcre ?? 0) >= 40000) || liveBusinesses.some((b) => b.status === 'anchor') || liveBusinesses.length >= 2;
  if (!operating && imprPerAcre != null && imprPerAcre < 10000) signals.push('mostly land value (little or no building)');
  if (cu) signals.push(`in ${cu.toLowerCase()} tax program`);

  const tags = new Set();
  if (/^vacant/i.test(use ?? '') && (imprPerAcre ?? 0) < 5000) tags.add('vacant-land');
  if (operating) tags.add('operating-business');
  if (businesses.some((b) => b.status === 'anchor')) tags.add('anchor-tenant');
  // A listed closing chain, or every business on site marked closed (not one shuttered kiosk inside a busy store).
  if (businesses.some((b) => b.status === 'closing' && b.note && !/OpenStreetMap/.test(b.note)) || (businesses.length && businesses.every((b) => b.status === 'closing'))) tags.add('closing-tenant');
  if (operatingUse && !operating) tags.add('possible-empty-building');
  if (operating && (corporateMail || liveBusinesses.length) && (oType === 'individual' || oType === 'trust' || oType === 'llc')) tags.add('leased-to-business');
  if (operating && oType === 'company') tags.add('company-owned');
  if (corporateMail) tags.add('tax-bill-to-business');
  let excluded = null;
  if (acct.taxStat === 'X') excluded = 'tax exempt (public, tribal or nonprofit)';
  else if (use && PUBLIC_USE.test(use)) excluded = `public or institutional use (${use})`;

  rows.push([pin, p.ADDR_FULL?.trim() || null, city, postal, p.ZIP5 || null, p.KCA_ACRES, zone, sports.verdict, sports.note, sports.source ?? null, use, p.PROPTYPE ?? null,
    land, impr, acct.taxStat || null, cu, acct.addr || null, acct.cityState || null, absentee, outOfState, lat, lng, JSON.stringify(f.geometry),
    yh ?? null, own.yearsSinceTransfer ?? null, JSON.stringify(signals), mkt.rich, mkt.share, mkt.kids,
    excluded, JSON.stringify([...tags]), JSON.stringify(businesses), oType, acct.attn || null]);
}

const COLS = ['pin', 'address', 'city', 'postal_city', 'zip', 'acres', 'zoning', 'sports_verdict', 'sports_note', 'zoning_source', 'present_use', 'prop_type',
  'land_value', 'impr_value', 'tax_status', 'current_use', 'mail_address', 'mail_city_state', 'absentee', 'out_of_state', 'lat', 'lng', 'geometry_json',
  'years_held', 'years_since_transfer', 'signals', 'hh200k_10mi', 'share200k_10mi', 'kids_share_10mi',
  'excluded', 'tags', 'businesses', 'owner_type', 'mail_attn'];

const client = await connect();
await client.query('BEGIN');
await client.query('DELETE FROM candidates');
await insertMany(client, 'candidates', COLS, rows);
await setMeta(client, 'candidates', rows.length, 'King County GIS parcels 5+ acres + assessor accounts + sales + ACS');
await client.query('COMMIT');
await client.query('ANALYZE candidates');
const { rows: summary } = await client.query(`SELECT count(*) FILTER (WHERE excluded IS NULL) AS shown, count(*) AS total,
  count(*) FILTER (WHERE excluded IS NULL AND sports_verdict = 'permitted') AS permitted,
  count(*) FILTER (WHERE excluded IS NULL AND sports_verdict = 'conditional') AS conditional,
  count(*) FILTER (WHERE excluded IS NULL AND sports_verdict = 'unknown') AS unknown,
  count(*) FILTER (WHERE tags LIKE '%operating-business%') AS operating, count(*) FILTER (WHERE tags LIKE '%leased-to-business%') AS leased,
  count(*) FILTER (WHERE tags LIKE '%closing-tenant%') AS closing, count(*) FILTER (WHERE tags LIKE '%possible-empty%') AS empty_bldg,
  count(*) FILTER (WHERE tags LIKE '%vacant-land%') AS vacant_land FROM candidates`);
await client.end();
console.log('Candidates:', summary[0]);
