import Anthropic from '@anthropic-ai/sdk';
import { all, one, run, pool, totalSpend } from './db.js';
import { newId } from './ids.js';
import { hasClaude } from './compiler.js';
import { countyOf } from './counties.js';

// "Research this parcel": Claude searches the public web for what's known about one site (listings, permits
// and land-use applications, news, businesses at the address, environmental issues) and reports each finding
// with the pages it came from. Results are unverified: the fit statement shows them as Likely, never Known.
// Searches use the address and parcel number only — never the owner's name.

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6, search: 10 / 1000 }; // USD
const MAX_SPEND = Number(process.env.MAX_SPEND_USD ?? 2);
export const RESEARCH_CREDITS = Number(process.env.RESEARCH_CREDITS ?? 1);
// People-search and data-broker sites profile private individuals: never a source for Paydirt.
const BLOCKED = ['spokeo.com', 'neighborwho.com', 'clustrmaps.com', 'whitepages.com', 'fastpeoplesearch.com', 'truepeoplesearch.com',
  'beenverified.com', 'radaris.com', 'intelius.com', 'peoplefinders.com', 'mylife.com', 'instantcheckmate.com', 'truthfinder.com', 'peekyou.com'];
const CATEGORIES = ['Listing', 'Permits', 'Land use', 'News', 'Business', 'Environment', 'Other'];

let client = null;
const claude = () => (client ??= new Anthropic());

const SYSTEM = `You research one parcel of land for a developer deciding whether to buy it. Search the public web and report what you find about this specific site.

Look for, in this order:
1. Listing: is it, or was it recently, listed for sale or lease (asking price, broker, date)?
2. Permits and land-use applications: building permits, subdivisions, rezones, SEPA or environmental notices, code enforcement.
3. Business: businesses operating at the address.
4. News or public meetings that mention the site or its address.
5. Environment: contamination, cleanup sites, flooding, wetlands named for this site.

Rules:
- Only report what a source says about THIS site (its address or parcel number). Skip results about other properties or general area information.
- Never search for or report the owner's name or other personal details about private individuals, and don't use people-search sites.
- Every finding must come from a page you found. Don't infer or guess.
- Write each finding as one line: "- [Category] finding, with the date if the source gives one." Categories: ${CATEGORIES.join(', ')}.
- If you find nothing about this site, write exactly one line: "- [Other] No public web results mention this site."
- No introduction or closing summary; only the finding lines.`;

function describe(c) {
  const county = countyOf(c.county_fips ?? '53033');
  const where = c.address ? `${c.address}, ${c.city || c.postal_city || ''}`.replace(/,\s*$/, '') : c.address_near ? `no street address; near ${c.address_near}` : 'no street address';
  return [`Address: ${where}`, `County: ${county?.name ?? ''}, ${county?.state ?? 'WA'}`, `Parcel number: ${c.pin}`,
    `Size: ${c.acres?.toFixed(1)} acres`, c.zoning && `Zoning code: ${c.zoning}`, c.present_use && `Assessor's present use: ${c.present_use}`].filter(Boolean).join('\n');
}

// Turn the reply's text blocks into finding lines, each keeping the pages cited inside it.
export function findingsFrom(content) {
  const lines = [{ text: '', sources: new Map() }];
  for (const b of content) {
    if (b.type !== 'text') continue;
    const parts = b.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push({ text: '', sources: new Map() });
      const line = lines.at(-1);
      line.text += part;
      // Only where the block adds words: a stray "." before a newline must not carry the next claim's source back.
      if (/[A-Za-z0-9]{2,}/.test(part)) for (const ct of b.citations ?? []) if (ct.url) line.sources.set(ct.url, { url: ct.url, title: ct.title ?? ct.url });
    });
  }
  return lines.map((l) => {
    const m = l.text.trim().match(/^-\s*\[([^\]]+)\]\s*(.+)$/);
    if (!m) return null;
    return { category: CATEGORIES.includes(m[1]) ? m[1] : 'Other', text: m[2].trim(), sources: [...l.sources.values()] };
  }).filter(Boolean);
}

export async function latestResearch(pin) {
  const r = await one('SELECT research_uid, findings, created_at FROM parcel_research WHERE pin = ? ORDER BY created_at DESC LIMIT 1', [pin]);
  return r ? { id: r.research_uid, findings: JSON.parse(r.findings), createdAt: r.created_at } : null;
}

export async function researchParcel(user, c) {
  if (!hasClaude()) throw Object.assign(new Error('Research needs the Anthropic API key in .env.'), { status: 400 });
  const orgUid = user?.orgUid;
  if (!orgUid) throw Object.assign(new Error('Join an organization before running research.'), { status: 403 });
  const bal = (await one('SELECT COALESCE(sum(delta), 0)::int AS n FROM credit_ledger WHERE org_uid = ?', [orgUid])).n;
  if (bal < RESEARCH_CREDITS) throw Object.assign(new Error(`Research costs ${RESEARCH_CREDITS} credit; you have ${bal}.`), { status: 402 });
  const spent = await totalSpend();
  if (spent + 0.5 > MAX_SPEND) throw Object.assign(new Error(`Spend cap reached: $${spent.toFixed(2)} of $${MAX_SPEND.toFixed(2)} used.`), { status: 402 });

  const callId = (await one('INSERT INTO api_calls (endpoint, request_json) VALUES (?, ?) RETURNING id', ['claude/research', JSON.stringify({ model: MODEL, pin: c.pin })])).id;
  const messages = [{ role: 'user', content: describe(c) }];
  let res, cost = 0, searches = 0;
  try {
    // A long search can pause; hand the paused turn back so the server continues it (at most 3 rounds).
    for (let round = 0; round < 3; round++) {
      res = await claude().beta.messages.create({
        model: MODEL, max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        // The basic search tool: every claim comes back with a citation. (The filtering variant ran results through code and lost them.)
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, blocked_domains: BLOCKED, user_location: { type: 'approximate', country: 'US', region: 'Washington' } }],
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
  } catch (err) {
    await run('UPDATE api_calls SET error = ? WHERE id = ?', [String(err.message).slice(0, 2000), callId]);
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Research is busy right now; try again in a minute.'), { status: 503 });
    if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`Research failed (${err.status}).`), { status: 502 });
    throw err;
  }
  await run('UPDATE api_calls SET status = 200, charged_usd = ?, result_count = ?, error = ? WHERE id = ?',
    [Math.round(cost * 10000) / 10000, searches, res.stop_reason === 'end_turn' ? null : res.stop_reason, callId]);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('Research was declined for this site.'), { status: 422 });
  const findings = findingsFrom(res.content);
  if (!findings.length) throw Object.assign(new Error('Research came back empty; try again.'), { status: 502 });

  // Save and charge together: a failed save never charges.
  const uid = newId('rsc');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO parcel_research (research_uid, pin, property_uid, org_uid, findings, searches, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uid, c.pin, c.property_uid ?? null, orgUid, JSON.stringify(findings), searches, user?.uid ?? null]);
    await db.query(`INSERT INTO credit_ledger (entry_uid, org_uid, delta, reason, ref, note, created_by) VALUES ($1, $2, $3, 'research', $4, $5, $6)`,
      [newId('crd'), orgUid, -RESEARCH_CREDITS, uid, `Web research: parcel ${c.pin}`, user?.uid ?? null]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; } finally { db.release(); }
  return { id: uid, findings, createdAt: new Date().toISOString(), balance: bal - RESEARCH_CREDITS };
}

export const researchHistory = (pin) => all('SELECT research_uid, created_at, searches FROM parcel_research WHERE pin = ? ORDER BY created_at DESC LIMIT 10', [pin]);
