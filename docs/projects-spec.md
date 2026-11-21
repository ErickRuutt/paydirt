# Projects and criteria: spec v1 (draft)

Nov 21, 2026. A draft to react to, not settled.

## Who uses it

Anyone on the team, and users, create projects. Eventually buyers create their own (self-serve),
so every input method must work without us in the loop: the interview and markdown import have to
produce a good spec on their own, and anything ambiguous goes back to the person as a question,
never a silent guess.

## What a project is

A project is one buyer's search. It holds:

- **Brief** — who it's for and why, in plain words (and any uploaded markdown files, kept as sources).
- **Criteria spec** — structured, versioned (see below). Every way of writing criteria compiles into it.
- **Areas** — the counties or regions it searches. A project can span several areas; each area is
  bought/unlocked separately (fits "buy an area once").
- **Results** — scored candidates (computed on read from the spec; never stored as a copy).
- **Shortlist and reviews** — status and notes per parcel, *owned by the project* (today they're global).
- **Enrichments** — paid checks run for this project. The facts go into the shared data layer
  (so the next project gets them free); the project keeps a record of what it paid for.
- **Members** — who can see and edit (team, client, buyer).
- **History** — every change to the spec, who made it and why.

## The criteria spec

One JSON document. Each criterion is either a **requirement** (filters: parcels failing it are hidden,
with the reason shown) or a **preference** (scores: adds or subtracts points). Each carries a
`why` — the sentence from the brief, interview answer or user that justified it.

```jsonc
{
  "version": 3,
  "uses": [                               // each use needs zoning rules per jurisdiction
    { "use": "sports_facility", "role": "primary" },
    { "use": "restaurant", "role": "accessory" },
    { "use": "office", "role": "accessory" }
  ],
  "requirements": [
    { "field": "acres", "op": "between", "value": [13, 40], "why": "Two full-size fields plus parking" },
    { "field": "zoning.sports_facility", "op": "in", "value": ["permitted", "conditional"], "why": "..." },
    { "field": "drive_minutes_from", "op": "lte", "value": 30, "points": ["Redmond", "Sammamish"], "why": "Families within 20–30 min" }
  ],
  "preferences": [
    { "field": "hh200k_within_20min", "weight": 25, "target": 40000, "why": "Affluent families" },
    { "field": "owner_signals", "weight": 35, "signals": { "inherited": 20, "held_20y": 25 }, "why": "Off-market outreach" },
    { "field": "slope_median_pct", "weight": 10, "lte": 5, "why": "Fields need flat land" },
    { "field": "land_value_per_acre", "weight": 10, "lte": 400000, "why": "Budget" }
  ],
  "areas": ["WA:King"]
}
```

Fields are a fixed, documented catalog (the same list the form, interview, markdown compiler and
MCP all use). New fields are added to the catalog, not invented per project.

## Ways to write criteria (all compile to the spec)

1. **Build your own** — form over the catalog. Today's profile editor, grown up.
2. **Markdown** — upload a brief. Claude extracts a draft spec with a `why` quote per criterion,
   lists what it couldn't decide as questions, and shows a diff. Nothing applies until a person approves.
3. **Interview** — a guided chat that fills the spec section by section (use, size, area/drive time,
   budget, timing, deal-breakers, nice-to-haves), then shows the spec for approval. Same compiler as #2.
4. **Map and list filters** — temporary narrowing for this session; "save to project" turns one into a requirement.
5. **MCP (agents)** — tools: `create_project`, `get_spec`, `propose_spec_change` (needs approval or a
   permission), `search`, `get_parcel`, `enrich_parcel` (metered), `add_note`, `set_status`.
   Same API, same metering and spend caps as the web app; per-user or per-org API keys.

## Scoring

Unchanged in principle from search profiles: requirements → SQL `WHERE`, preferences → SQL score
expressions, computed on read over the shared candidates table. Requirements that need paid data
(slope, drive time) apply only to parcels that have it; the rest show "unchecked" rather than
passing or failing silently.

## Open questions

- **Uses and zoning:** each new use needs zoning rules read per jurisdiction. That's the real cost of
  supporting new buyer types; an AI-assisted reader with human review is the likely path.
- **Approval rules for agents:** may an agent change a spec or spend tokens on its own, or only propose?
- **Buyer privacy:** a buyer's project (where they're looking) is sensitive; shared data must never
  reveal another project's criteria or shortlist.
- **Billing:** does enrichment cost come from the project, the member, or the org?

## Build order

1. ~~Projects + spec v1 (requirements vs preferences, project-owned shortlist and notes, history).~~ Done Nov 21, 2026 (`src/spec.js`, `src/projects.js`). Not yet: per-project access (`project_members` is recorded but not enforced), drive-time requirements, slope preferences, multiple uses in zoning.
2. Markdown + interview compiler (one Claude-backed compiler, approval step, `why` quotes).
3. MCP server over the same API, with keys and metering.
4. Zoning rules for more uses (restaurant, office) so multi-use projects score correctly.
