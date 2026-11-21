import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { db, totalSpend } from './db.js';

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
  if (!key) throw httpError(400, 'No Mireye key found. Run mireye-mcp connect, or set MIREYE_API_KEY in .env.');
  const spent = totalSpend();
  if (spent + quoteUsd > MAX_SPEND) {
    throw httpError(402, `Spend cap reached: $${spent.toFixed(2)} of $${MAX_SPEND.toFixed(2)} used. Raise MAX_SPEND_USD in .env to continue.`);
  }
  const log = db.prepare('INSERT INTO api_calls (endpoint, request_json) VALUES (?, ?)').run(endpoint, JSON.stringify(body));
  const callId = log.lastInsertRowid;

  let res, json;
  try {
    res = await fetch(BASE + endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Idempotency-Key': `fh-${randomUUID()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    json = await res.json().catch(() => ({}));
  } catch (err) {
    db.prepare('UPDATE api_calls SET error = ? WHERE id = ?').run(String(err.message), callId);
    throw httpError(504, `Mireye request failed: ${err.message}`);
  }

  const charged = Number(json?.billing?.charged_usd ?? 0);
  db.prepare('UPDATE api_calls SET status = ?, charged_usd = ?, error = ? WHERE id = ?')
    .run(res.status, charged, res.ok ? null : JSON.stringify(json).slice(0, 2000), callId);

  if (!res.ok) {
    const code = json?.error?.code ?? json?.code ?? res.status;
    const msg = json?.error?.message ?? json?.message ?? JSON.stringify(json).slice(0, 300);
    throw httpError(res.status, `Mireye ${code}: ${msg}`);
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
  db.prepare('UPDATE api_calls SET result_count = ? WHERE id = ?').run(json.matches?.length ?? 0, callId);
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
