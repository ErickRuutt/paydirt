// Build the candidates table: every King County parcel of 5+ acres, scored for
//   fit    – can a sports club go here (zoning), size, how built-up it is
//   owner  – signs the owner might sell (long hold, inheritance, trust, absentee, underused land)
//   market – $200k+ households within 10 miles (straight line)
// Free county data only. Inputs in data/raw/:
//   gis-parcels.json            (npm run fetch:gis — boundaries, address, zoning, use, values)
//   account/EXTR_RPAcct_NoName.csv (Real Property Account.zip — mailing address, tax status)
//   parcel/EXTR_Parcel.csv      (Parcel.zip — current-use tax program)
// Needs sales and block_groups already loaded (import:sales, import:census).
// Usage: npm run import:candidates
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { connect, insertMany, setMeta, splitCsv } from './lib/pg-script.js';
import { ownershipForMany } from '../src/ownership.js';
import { pool } from '../src/db.js';
import { sportsClubVerdict } from '../src/zoning-kc.js';

const RAW = new URL('../data/raw/', import.meta.url).pathname;
const criteria = JSON.parse(readFileSync(new URL('../criteria.json', import.meta.url)));
const { acresMin, acresMax } = criteria.search;

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
  accounts.set(pin, { addr: get('AddrLine'), cityState: get('CityState').replace(/\s+/g, ' '), zip: get('ZipCode'), taxStat: get('TaxStat') });
}
console.log(`${accounts.size.toLocaleString()} matched tax accounts.`);

const CURRENT_USE = { 1: 'Agriculture', 2: 'Timber', 3: 'Open space', 4: 'Forest land', 5: 'Designated forest land' };
const currentUse = new Map();
for await (const get of csv(RAW + 'parcel/EXTR_Parcel.csv')) {
  const pin = pinOf(get);
  const c = Number(get('CurrentUseDesignation'));
  if (pins.has(pin) && c) currentUse.set(pin, CURRENT_USE[c] ?? `Code ${c}`);
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
const PUBLIC_USE = /^(Park, Public|School|Right of Way|Utility, Public|Governmental|Golf|Cemetery|Water Body|Reserve\/Wilderness|Military|Tideland|Church|Condominium|Apartment|Mobile Home Park|Open Space)/i;
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

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

  // Fit: zoning, size, how built-up.
  const zoningPts = { permitted: 45, conditional: 30, unknown: 15, prohibited: 0 }[sports.verdict];
  const sizePts = p.KCA_ACRES >= acresMin && p.KCA_ACRES <= acresMax ? 30 : p.KCA_ACRES >= 8 && p.KCA_ACRES < acresMin ? 15 : 5;
  const usePts = /^vacant/i.test(use ?? '') ? 25 : /single family|mobile home|agricultur/i.test(use ?? '') ? 12 : 0;
  const fit = clamp(zoningPts + sizePts + usePts);

  // Owner: signs they might sell.
  const signals = [...(own.signals ?? []).filter((s) => s !== 'no recorded sales')];
  let ownPts = 0;
  const yh = own.yearsSinceMarketSale;
  if (yh != null && yh >= 30) ownPts += 35; else if (yh != null && yh >= 20) ownPts += 25;
  if (own.records && yh == null) ownPts += 25;
  if (signals.includes('recently inherited')) ownPts += 30; else if (signals.includes('inherited')) ownPts += 20;
  if (signals.includes('last transfer was family or trust')) ownPts += 15;
  if (signals.includes('bought within 3 years')) ownPts -= 25;
  if (outOfState) { ownPts += 15; signals.push('owner mails from out of state'); }
  else if (absentee) { ownPts += 10; signals.push('owner mails from another city'); }
  const landShare = land != null && impr != null && land + impr > 0 ? land / (land + impr) : null;
  if (landShare != null && landShare >= 0.85 && land > 0) { ownPts += 15; signals.push('mostly land value (little or no building)'); }
  if (cu) signals.push(`in ${cu.toLowerCase()} tax program`);
  const ownerScore = clamp(ownPts);

  // Market: $200k+ households within 10 miles; 60k or more scores 100.
  const market = mkt.rich == null ? 0 : clamp((mkt.rich / 60000) * 100);

  const score = clamp(0.4 * fit + 0.35 * ownerScore + 0.25 * market);

  let excluded = null;
  if (acct.taxStat === 'X') excluded = 'tax exempt (public, tribal or nonprofit)';
  else if (use && PUBLIC_USE.test(use)) excluded = `public or institutional use (${use})`;
  else if (sports.verdict === 'prohibited') excluded = `zoning: ${sports.note}`;
  else if (p.KCA_ACRES > 80) excluded = 'over 80 acres';

  rows.push([pin, p.ADDR_FULL?.trim() || null, city, postal, p.ZIP5 || null, p.KCA_ACRES, zone, sports.verdict, sports.note, use, p.PROPTYPE ?? null,
    land, impr, acct.taxStat || null, cu, acct.addr || null, acct.cityState || null, absentee, outOfState, lat, lng, JSON.stringify(f.geometry),
    yh ?? null, own.yearsSinceTransfer ?? null, JSON.stringify(signals), mkt.rich, mkt.share, mkt.kids,
    fit, ownerScore, market, score, excluded]);
}

const COLS = ['pin', 'address', 'city', 'postal_city', 'zip', 'acres', 'zoning', 'sports_verdict', 'sports_note', 'present_use', 'prop_type',
  'land_value', 'impr_value', 'tax_status', 'current_use', 'mail_address', 'mail_city_state', 'absentee', 'out_of_state', 'lat', 'lng', 'geometry_json',
  'years_held', 'years_since_transfer', 'signals', 'hh200k_10mi', 'share200k_10mi', 'kids_share_10mi',
  'fit_score', 'owner_score', 'market_score', 'score', 'excluded'];

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
  count(*) FILTER (WHERE excluded IS NULL AND sports_verdict = 'unknown') AS city_unknown FROM candidates`);
await client.end();
console.log('Candidates:', summary[0]);
