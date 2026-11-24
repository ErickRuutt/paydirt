import Anthropic from '@anthropic-ai/sdk';
import { all, one, run, pool, totalSpend } from './db.js';
import { newId } from './ids.js';
import { hasClaude } from './compiler.js';
import { countyOf } from './counties.js';
import { jurisdictionKey, applyVerdicts, SPORTS_USE } from './zoneLayers.js';

// "Read the zoning rules": Claude finds a city's or county's current zoning code on the public web, reads its
// use table, and answers for each zone on our parcels whether a sports facility is allowed. Each answer is stored
// once per jurisdiction, zone and use (zoning_rules) and reused by every project. Answers are marked "read":
// shown as Likely, with the code section, until a person confirms them.

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, search: 10 / 1000 }; // USD
const MAX_SPEND = Number(process.env.MAX_SPEND_USD ?? 2);
export const ZONING_READ_CREDITS = Number(process.env.ZONING_READ_CREDITS ?? 3);
const VERDICTS = ['permitted', 'conditional', 'prohibited', 'unknown'];
const err = (status, message) => Object.assign(new Error(message), { status });

let client = null;
const claude = () => (client ??= new Anthropic());

const SYSTEM = `You read a local zoning code for a land buyer. For one jurisdiction you are given its zone codes. Find the jurisdiction's current, official zoning code on the web (the municipal or county code host, or the jurisdiction's own site), open the permitted-use table or the use lists for each zone, and answer for each zone whether this use is allowed:

Use: a sports facility — an indoor athletic facility (courts, turf, training) together with outdoor sports fields rented to teams and the public, run as a business or nonprofit.

Verdicts:
- permitted: both the indoor facility and the outdoor fields are allowed outright (development conditions may still apply).
- conditional: a conditional use permit, hearing or other discretionary approval is needed, or only part of the program (indoor only, or fields only) is allowed.
- prohibited: neither is listed or allowed in the zone.
- unknown: you could not find this zone in the code you read, or the code is unclear. Never guess.

Rules:
- Read the code itself. Don't rely on summaries, news or real-estate sites.
- Pick the use categories the code would put this under (for example commercial recreation, indoor recreation, athletic club, sports fields, parks and recreation) and say which you used.
- Answer every zone you were given, one line each, exactly:
  ZONE | <zone code only, exactly as given, without its name> | <verdict> | <one or two sentences: what the code allows and under which use category, ending with the section in parentheses, e.g. (GHMC 17.14.020)>
- Then one line with the page the use table is on:  SOURCE | <url>
- Then one line with the date the code says it was last updated, if shown:  CURRENT | <date or "not shown">
- No other text.`;

export function parseReading(text, zones) {
  const want = new Map(zones.map((z) => [z.toUpperCase(), z]));
  const rules = new Map();
  let source = null, current = null;
  for (const raw of String(text).split('\n')) {
    const p = raw.trim().replace(/^[-*]\s*/, '').split('|').map((s) => s.trim());
    if (p[0] === 'ZONE' && p.length >= 4) {
      // The zone may come back with its name attached: "R-1 (Single-Family Residential)".
      const zone = want.get(p[1].toUpperCase()) ?? want.get(p[1].replace(/\s*\(.*$/, '').toUpperCase()), verdict = p[2].toLowerCase();
      if (zone && VERDICTS.includes(verdict)) rules.set(zone, { zone, verdict, note: p.slice(3).join(' | ') });
    } else if (p[0] === 'SOURCE' && /^https?:\/\//.test(p[1] ?? '')) source = p[1];
    else if (p[0] === 'CURRENT' && p[1] && !/not shown/i.test(p[1])) current = p[1];
  }
  return { rules: [...rules.values()], source, current };
}

const placeName = (fips, city) => (city ? `the City of ${city.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase())}` : `unincorporated ${countyOf(fips)?.name ?? 'county'}`);

// What reading would cover for one place, and whether it has been done.
export async function readingStatus(fips, city) {
  const zones = await all(`SELECT zoning AS zone, max(zone_name) AS name, count(*)::int AS sites FROM candidates
    WHERE county_fips = ? AND city IS NOT DISTINCT FROM ? AND zoning IS NOT NULL GROUP BY zoning ORDER BY count(*) DESC`, [String(fips), city ?? null]);
  const read = await one('SELECT count(*)::int AS n, max(read_at) AS read_at FROM zoning_rules WHERE jurisdiction = ? AND use = ?', [jurisdictionKey(fips, city), SPORTS_USE]);
  return { zones, read: read.n > 0, readAt: read.read_at, credits: ZONING_READ_CREDITS, canRead: hasClaude() && zones.length > 0 };
}

export async function readZoning(user, { fips, city = null }) {
  fips = String(fips); city = city || null;
  const orgUid = user?.orgUid;
  if (!orgUid) throw err(403, 'Join an organization before reading zoning rules.');
  const st = await readingStatus(fips, city);
  const place = placeName(fips, city), key = jurisdictionKey(fips, city);
  // Already read for someone: the answers are shared, so nothing is charged.
  if (st.read) return { already: true, applied: await applyVerdicts(fips, city), place };
  if (!hasClaude()) throw err(400, 'Reading zoning rules needs the Anthropic API key in .env.');
  if (!st.zones.length) throw err(400, `Paydirt has no zone codes for ${place} yet, so there is nothing to read the rules for.`);
  const bal = (await one('SELECT COALESCE(sum(delta), 0)::int AS n FROM credit_ledger WHERE org_uid = ?', [orgUid])).n;
  if (bal < ZONING_READ_CREDITS) throw err(402, `Reading zoning rules costs ${ZONING_READ_CREDITS} credits; you have ${bal}.`);
  if ((await totalSpend()) + 1 > MAX_SPEND) throw err(402, 'This is paused for now: Paydirt has reached its own data budget. Tell us with the Feedback button and we\'ll raise it.');

  const zones = st.zones.slice(0, 80);
  const ask = `Jurisdiction: ${place}, ${countyOf(fips)?.name ?? ''}, ${countyOf(fips)?.state ?? 'WA'}\nZones:\n${zones.map((z) => `- ${z.zone}${z.name ? ` (${z.name})` : ''}`).join('\n')}`;
  const callId = (await one('INSERT INTO api_calls (endpoint, request_json) VALUES (?, ?) RETURNING id', ['claude/zoning', JSON.stringify({ model: MODEL, jurisdiction: key })])).id;
  const messages = [{ role: 'user', content: ask }];
  let res, cost = 0, searches = 0;
  try {
    for (let round = 0; round < 4; round++) {
      res = await claude().beta.messages.create({
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'US', region: 'Washington' } },
          { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 10, max_content_tokens: 60000 }],
        messages,
      });
      const u = res.usage ?? {};
      searches += u.server_tool_use?.web_search_requests ?? 0;
      cost += (u.input_tokens ?? 0) * PRICE.input + (u.cache_creation_input_tokens ?? 0) * PRICE.input * 1.25
        + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.output_tokens ?? 0) * PRICE.output;
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
    cost += searches * PRICE.search;
  } catch (e) {
    await run('UPDATE api_calls SET error = ? WHERE id = ?', [String(e.message).slice(0, 2000), callId]);
    if (e instanceof Anthropic.RateLimitError) throw err(503, 'Reading is busy right now; try again in a minute.');
    if (e instanceof Anthropic.APIError) throw err(502, `Reading the zoning rules failed (${e.status}).`);
    throw e;
  }
  await run('UPDATE api_calls SET status = 200, charged_usd = ?, result_count = ?, error = ? WHERE id = ?',
    [Math.round(cost * 10000) / 10000, searches, res.stop_reason === 'end_turn' ? null : res.stop_reason, callId]);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const { rules, source, current } = parseReading(text, zones.map((z) => z.zone));
  // Keep what came back when it can't be used, so a failed read can be diagnosed without paying for another.
  if (!source || !rules.some((r) => r.verdict !== 'unknown')) await run('UPDATE api_calls SET error = ? WHERE id = ?', [`unusable (${res.stop_reason}; ${res.content.map((b) => b.type).join(',')}): ${text}`.slice(0, 4000), callId]);
  // No page to point at means nothing a person could check: treat it as a failed read, and charge nothing.
  if (!source || !rules.some((r) => r.verdict !== 'unknown')) throw err(502, `Paydirt couldn't find and read ${place}'s zoning code. Nothing was charged; ask us to read it by hand with the Feedback button.`);

  const names = new Map(zones.map((z) => [z.zone, z.name]));
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const r of rules) {
      await db.query(`INSERT INTO zoning_rules (jurisdiction, zone, use, verdict, source_url, notes, zone_name, basis, read_at, read_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'read', now(), $8)
        ON CONFLICT (jurisdiction, zone, use) DO UPDATE SET verdict = excluded.verdict, source_url = excluded.source_url, notes = excluded.notes,
          zone_name = excluded.zone_name, read_at = now(), read_by = excluded.read_by, updated_at = now() WHERE zoning_rules.basis = 'read'`,
      [key, r.zone, SPORTS_USE, r.verdict, source, current ? `${r.note} Code current as of ${current}.` : r.note, names.get(r.zone) ?? null, MODEL]);
    }
    const applied = await applyVerdicts(fips, city, db);
    await db.query(`INSERT INTO credit_ledger (entry_uid, org_uid, delta, reason, ref, note, created_by) VALUES ($1, $2, $3, 'zoning_read', $4, $5, $6)`,
      [newId('crd'), orgUid, -ZONING_READ_CREDITS, key, `Zoning rules read: ${place}`, user?.uid ?? null]);
    await db.query('COMMIT');
    return { already: false, applied, zones: rules.length, source, place, credits: ZONING_READ_CREDITS, balance: bal - ZONING_READ_CREDITS };
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
}
