import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { one, run, totalSpend } from './db.js';
import { REQUIREMENT_FIELDS, PREFERENCE_FIELDS, SIGNAL_LABELS, PENDING_KEYS, normalizeSpec } from './spec.js';

// Turns words (a markdown brief, or an interview) into a draft criteria spec for a person to approve.
// Nothing here saves a project: the caller shows the draft and the person decides.

const MODEL = 'claude-opus-5-5';
const PRICE = { input: 4 / 1e6, output: 20 / 1e6, cacheRead: 0.2 / 1e6 }; // USD per token, Claude Opus 5.5
const MAX_SPEND = Number(process.env.MAX_SPEND_USD ?? 2);
const QUOTE_USD = 0.25; // generous per-call estimate for the spend cap check

let client = null;
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function claude() {
  if (!hasClaude()) throw Object.assign(new Error('No Anthropic API key. Add ANTHROPIC_API_KEY to .env (and to Vercel).'), { status: 400 });
  client ??= new Anthropic();
  return client;
}

// ---------- Output schema (structured outputs) ----------
const SIGNAL_KEYS = Object.keys(SIGNAL_LABELS);
const SignalPoints = z.object(Object.fromEntries(SIGNAL_KEYS.map((k) => [k, z.number().nullable()])));
const Requirement = z.object({
  field: z.enum(Object.keys(REQUIREMENT_FIELDS)),
  range: z.array(z.number().nullable()).nullable().describe('For range fields: [min, max]; null for an open end.'),
  options: z.array(z.string()).nullable().describe('For set fields: the allowed options, exactly as listed in the catalog.'),
  places: z.array(z.string()).nullable().describe('For the area field: city or town names.'),
  number: z.number().nullable().describe('For min/max fields: the threshold.'),
  why: z.string().describe('Quote or close paraphrase of the source that justifies this, or "Assumed: <reason>" if not stated.'),
});
const Preference = z.object({
  field: z.enum(Object.keys(PREFERENCE_FIELDS)),
  weight: z.number().describe('Relative importance, 0–100. Weights are normalized, so only their ratios matter.'),
  min: z.number().nullable().describe('acres preference only: target minimum acres.'),
  max: z.number().nullable().describe('acres preference only: target maximum acres.'),
  target: z.number().nullable().describe('hh200k_10mi: households for a full score; land_value_per_acre: $/acre for a full score.'),
  signal_points: SignalPoints.nullable().describe('owner_signals only: points per signal (negative allowed); null to keep defaults.'),
  why: z.string(),
});
const Draft = z.object({
  name: z.string().describe('Short project name.'),
  brief: z.string().describe('Two to four plain sentences: who it is for and what they need.'),
  requirements: z.array(Requirement),
  preferences: z.array(Preference),
  questions: z.array(z.string()).describe('Things that are unclear or missing and would change the criteria. Ask, never guess.'),
  pending: z.array(z.object({
    key: z.enum(PENDING_KEYS).describe('drive_time: travel time from a place; buildable: slope, wetlands or flood limits; other_use_zoning: zoning for any use other than a sports facility; listed_for_sale: only sites on the market.'),
    value: z.string().describe('What the person asked for, in their words, e.g. "Within 30 minutes of Redmond".'),
  })).describe('Wishes that match one of these not-yet-checkable kinds. They are saved on the project and shown as "not checked yet".'),
  unsupported: z.array(z.string()).describe('Other wishes the catalog cannot express yet (e.g. school ratings), so the person knows they are not applied.'),
  summary: z.string().describe('One or two sentences on what this draft does.'),
});
const InterviewTurn = z.object({
  reply: z.string().describe('What to say to the person next: one clear question, or a short wrap-up when done.'),
  done: z.boolean().describe('True when there is enough to draft criteria, or the person asked to finish.'),
  draft: Draft.nullable().describe('The draft criteria when done is true; otherwise null.'),
});

// ---------- Prompt ----------
function catalogText() {
  const req = Object.entries(REQUIREMENT_FIELDS).map(([k, d]) => `- ${k} (${d.type}${d.options ? `: ${d.options.join(', ')}` : ''}) — ${d.label}`).join('\n');
  const pref = Object.entries(PREFERENCE_FIELDS).map(([k, d]) => `- ${k} — ${d.label}; defaults ${JSON.stringify(d.params)}`).join('\n');
  const sig = Object.entries(SIGNAL_LABELS).map(([k, l]) => `- ${k}: ${l}`).join('\n');
  return `REQUIREMENT FIELDS (hard filters; a parcel failing one is hidden):\n${req}\n\nPREFERENCE FIELDS (each scores 0–100; weighted average is the parcel score):\n${pref}\n\nOWNER SIGNALS:\n${sig}`;
}

const SYSTEM = `You help land buyers turn what they want into search criteria for Paydirt, a tool that ranks King County, WA parcels of 5+ acres (on or off market).

Paydirt can only use the fields in this catalog. Use field names and option values exactly as written.

${catalogText()}

Facts about the data that affect the criteria:
- Zoning verdicts exist for one use only: a sports facility (indoor athletic space plus fields). For other uses, leave zoning out and list the use under "unsupported".
- "$200k+ households within 10 mi" is a straight-line count; a typical well-off suburb area has 40,000–90,000.
- Assessed land value per acre in King County ranges from under $20,000 (remote rural) to millions (urban).
- Tax-exempt and public parcels are always hidden; don't add criteria for that.

How to draft:
- Requirements are deal-breakers only. Anything the person merely prefers is a preference with a weight.
- Every criterion needs a "why": quote the person's words where possible. If you had to assume something, start the why with "Assumed:".
- Don't invent numbers the person didn't give. If a number matters and wasn't given, use a sensible value, mark it "Assumed:", and add a question about it.
- If something can't be expressed with the catalog (schools, slope limits, drive time from a specific place, utilities, price ceilings on listings), list it under "unsupported" in plain words.
- Keep questions few and specific (at most 5), and only about things that would change the criteria.
- Use plain, warm language in name, brief, summary, questions and why. No jargon.`;

const INTERVIEW_SYSTEM = `${SYSTEM}

You are interviewing the person to build these criteria. Ask one short question at a time, in plain language, in roughly this order, skipping anything already answered:
1. What they want to build or do on the land, and for whom.
2. How much land (and whether smaller parcels next to each other could work).
3. Where: towns or areas, and whether inside a city or rural county land is fine.
4. Who needs to be nearby (e.g. families with higher incomes) and how important that is.
5. Budget or price sensitivity.
6. Deal-breakers.
7. Whether they want owners who might sell even though the land isn't listed.
Stop after about 8 questions, or sooner when you have enough, or when the person says they're done. Then set done to true, give a short wrap-up in reply, and include the draft.`;

// ---------- Calls ----------
async function callClaude({ system, messages, schema, endpoint }) {
  const spent = await totalSpend();
  if (spent + QUOTE_USD > MAX_SPEND) throw Object.assign(new Error(`Spend cap reached: $${spent.toFixed(2)} of $${MAX_SPEND.toFixed(2)} used.`), { status: 402 });
  const callId = (await one('INSERT INTO api_calls (endpoint, request_json) VALUES (?, ?) RETURNING id',
    [endpoint, JSON.stringify({ model: MODEL, turns: messages.length })])).id;
  let res;
  try {
    res = await claude().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
    });
  } catch (err) {
    await run('UPDATE api_calls SET error = ? WHERE id = ?', [String(err.message).slice(0, 2000), callId]);
    if (err instanceof Anthropic.AuthenticationError) throw Object.assign(new Error('The Anthropic API key was rejected.'), { status: 502 });
    if (err instanceof Anthropic.RateLimitError) throw Object.assign(new Error('Claude is rate-limited right now; try again in a minute.'), { status: 503 });
    if (err instanceof Anthropic.APIError) throw Object.assign(new Error(`Claude request failed (${err.status}).`), { status: 502 });
    throw err;
  }
  const u = res.usage ?? {};
  const cost = (u.input_tokens ?? 0) * PRICE.input + (u.cache_creation_input_tokens ?? 0) * PRICE.input * 1.25
    + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.output_tokens ?? 0) * PRICE.output;
  await run('UPDATE api_calls SET status = 200, charged_usd = ?, result_count = 1, error = ? WHERE id = ?',
    [Math.round(cost * 10000) / 10000, res.stop_reason === 'end_turn' ? null : res.stop_reason, callId]);
  if (res.stop_reason === 'refusal') throw Object.assign(new Error('Claude declined to draft criteria from that text.'), { status: 422 });
  if (res.stop_reason === 'max_tokens') throw Object.assign(new Error('The draft was cut off; try a shorter brief.'), { status: 422 });
  if (!res.parsed_output) throw Object.assign(new Error('Claude returned something that could not be read as criteria.'), { status: 502 });
  return { out: res.parsed_output, costUsd: cost };
}

// Model output → spec v1, then validated by the same rules as the form.
function toSpec(draft) {
  const requirements = draft.requirements.map((r) => {
    const t = REQUIREMENT_FIELDS[r.field].type;
    const value = t === 'range' ? r.range : t === 'set' ? r.options : t === 'list' ? r.places : t === 'bool' ? true : r.number;
    return { field: r.field, value, why: r.why };
  });
  const preferences = draft.preferences.map((p) => {
    const params = {};
    if (p.field === 'acres') { if (p.min != null) params.min = p.min; if (p.max != null) params.max = p.max; }
    if ((p.field === 'hh200k_10mi' || p.field === 'land_value_per_acre') && p.target != null) params.target = p.target;
    if (p.field === 'owner_signals' && p.signal_points) params.points = Object.fromEntries(Object.entries(p.signal_points).filter(([, v]) => v != null));
    return { field: p.field, weight: p.weight, params, why: p.why };
  });
  return normalizeSpec({ uses: [{ use: 'sports_facility', role: 'primary' }], areas: ['WA:King'], requirements, preferences, pending: draft.pending ?? [] });
}

export const _forTests = { get Draft() { return Draft; }, get InterviewTurn() { return InterviewTurn; }, toSpec: (d) => toSpec(d) };

const present = (draft) => {
  const { spec, errors } = toSpec(draft);
  return { name: draft.name, brief: draft.brief, spec, summary: draft.summary, questions: draft.questions, unsupported: draft.unsupported, errors };
};

// Markdown/plain-text brief → draft. `current` (optional) is the project's existing spec to revise.
export async function draftFromText({ text, current }) {
  const body = String(text ?? '').trim();
  if (!body) throw Object.assign(new Error('Paste or upload a brief first.'), { status: 400 });
  if (body.length > 100_000) throw Object.assign(new Error('That brief is over 100,000 characters; trim it or split it.'), { status: 400 });
  const ask = current
    ? `Revise this project's current criteria using the brief below. Keep what the brief doesn't change.\n\nCURRENT CRITERIA (JSON):\n${JSON.stringify(current)}\n\nBRIEF:\n${body}`
    : `Draft criteria from this brief.\n\nBRIEF:\n${body}`;
  const { out, costUsd } = await callClaude({ system: SYSTEM, schema: Draft, endpoint: 'claude/draft-from-text', messages: [{ role: 'user', content: ask }] });
  return { ...present(out), costUsd };
}

// One interview turn. `messages` is the chat so far: [{ role: 'user'|'assistant', content: string }].
export async function interviewTurn({ messages }) {
  const msgs = (Array.isArray(messages) ? messages : []).slice(-40)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (!msgs.length || msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: 'Hi, I want to set up a land search.' });
  if (msgs.at(-1).role !== 'user') throw Object.assign(new Error('Waiting for your answer.'), { status: 400 });
  const { out, costUsd } = await callClaude({ system: INTERVIEW_SYSTEM, schema: InterviewTurn, endpoint: 'claude/interview', messages: msgs });
  return { reply: out.reply, done: out.done, draft: out.done && out.draft ? present(out.draft) : null, costUsd };
}
