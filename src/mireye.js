import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { one, run, totalSpend } from './db.js';

// Key lookup: MIREYE_API_KEY in .env wins; otherwise use the key saved by `mireye-mcp connect`.
// Read on each call so a key rotated by mireye-mcp is picked up without a restart.
const CREDENTIALS_PATH = join(homedir(), '.config', 'mireye-mcp', 'credentials.json');
function apiKey() {
  if (process.env.MIREYE_API_KEY) return process.env.MIREYE_API_KEY;
  try {
    const token = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')).token;
    return typeof token === 'string' && token.startsWith('mry_') ? token : null;
  } catch { return null; }
}
export const keySource = () => (process.env.MIREYE_API_KEY ? '.env' : apiKey() ? CREDENTIALS_PATH : null);

const BASE = 'https://api.mireye.com';
const MAX_SPEND = Number(process.env.MAX_SPEND_USD ?? 2);

// Fields returned by Search. All of them ride the flat $0.20/page price.
export const SEARCH_FIELDS = [
  'owner', 'mailadd', 'mail_city', 'mail_state2',
  'zoning', 'zoning_type', 'zoning_description', 'zoning_code_link', 'usedesc',
  'landval', 'parval', 'saleprice', 'saledate', 'last_ownership_transfer_date',
  'parcel_slope_pct_p50', 'parcel_slope_pct_p90', 'parcel_slope_frac_over_5pct', 'parcel_slope_valid_frac',
  'highest_parcel_elevation', 'lowest_parcel_elevation',
  'parcel_flood_sfha_fraction', 'wetland_fraction_of_parcel', 'developable_acres_proxy',
  'parcel_boundary_geojson', 'lat', 'lon',
];

export const hasKey = () => Boolean(apiKey());

async function call(endpoint, body, { quoteUsd, timeoutMs }) {
  const key = apiKey();
  if (!key) throw httpError(400, 'Paid parcel data isn\'t set up on this server (MIREYE_API_KEY).');
  const spent = await totalSpend();
  if (spent + quoteUsd > MAX_SPEND) {
    throw httpError(402, 'This is paused for now: Paydirt has reached its own data budget. Tell us with the Feedback button and we\'ll raise it.');
  }
  const callId = (await one('INSERT INTO api_calls (endpoint, request_json) VALUES (?, ?) RETURNING id', [endpoint, JSON.stringify(body)])).id;

  let res, json;
  try {
    res = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Idempotency-Key': `pd-${randomUUID()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    json = await res.json().catch(() => ({}));
  } catch (err) {
    await run('UPDATE api_calls SET error = ? WHERE id = ?', [String(err.message), callId]);
    throw httpError(504, `Parcel data request failed: ${err.message}`);
  }

  const charged = Number(json?.billing?.charged_usd ?? 0);
  await run('UPDATE api_calls SET status = ?, charged_usd = ?, error = ? WHERE id = ?',
    [res.status, charged, res.ok ? null : JSON.stringify(json).slice(0, 2000), callId]);

  if (!res.ok) {
    const code = json?.error?.code ?? json?.code ?? res.status;
    const msg = json?.error?.message ?? json?.message ?? JSON.stringify(json).slice(0, 300);
    throw httpError(res.status, `Parcel data error ${code}: ${msg}`);
  }
  return { json, callId, charged };
}

export async function searchParcels({ county, acresMin, acresMax, minDevelopableAcres, maxWetlandFraction, city, limit = 10, cursor }) {
  const filters = [
    { field: 'state2', op: 'eq', value: county.state2 },
    { field: 'county', op: 'eq', value: county.fips },
    { field: 'pvd_gisacre', op: 'between', value: [Number(acresMin), Number(acresMax)] },
  ];
  if (minDevelopableAcres) filters.push({ field: 'developable_acres_proxy', op: 'gte', value: Number(minDevelopableAcres) });
  if (maxWetlandFraction != null) filters.push({ field: 'wetland_fraction_of_parcel', op: 'lte', value: Number(maxWetlandFraction) });
  if (city) filters.push({ field: 'scity', op: 'eq', value: city.toUpperCase() });

  const body = { filters, fields: SEARCH_FIELDS, limit: Math.min(Math.max(1, Number(limit)), 100), max_cost_usd: '0.20' };
  if (cursor) body.cursor = cursor;
  const { json, callId, charged } = await call('/v1/search', body, { quoteUsd: 0.2, timeoutMs: 630_000 });
  await run('UPDATE api_calls SET result_count = ? WHERE id = ?', [json.matches?.length ?? 0, callId]);
  return { matches: json.matches ?? [], nextCursor: json.next_cursor ?? null, remarks: json.remarks ?? [], charged };
}

export async function enrichParcel({ lat, lng, presets }) {
  const body = { lat, lng, preset: presets, max_cost_usd: '0.02' };
  const { json, charged } = await call('/v1/enrich', body, { quoteUsd: 0.02, timeoutMs: 210_000 });
  return { result: json, charged };
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
