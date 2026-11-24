import { all } from './db.js';
import { ownershipFor } from './ownership.js';
import { KC_CODE_SOURCE } from './zoning-kc.js';
import { countyOf } from './counties.js';
import { latestResearch, RESEARCH_CREDITS } from './research.js';

// The fit statement: Paydirt's argument for (or against) buying and building on one site, for one project.
// docs/fit-statement.md. Every finding comes from facts already in the database, with its source and date;
// anything we hold no data for is reported as unknown and becomes a due-diligence item. Nothing is guessed.
//
// Finding: { key, label, verdict: favorable|neutral|unfavorable|unknown, basis: known|likely|unknown,
//            finding (one line), detail?, sources: [{ label, url?, asOf? }], check? (what to verify), dealBreaker? }

const isKing = (c) => (c.county_fips ?? '53033') === '53033';
const countyName = (c) => countyOf(c.county_fips ?? '53033')?.name ?? 'the county';
const GIS = (c) => countyOf(c.county_fips ?? '53033').sources.parcels;
const ASSESSOR = (c) => countyOf(c.county_fips ?? '53033').sources.assessor;
const KC_SALES = { label: 'King County Assessor sales records', url: 'https://info.kingcounty.gov/assessor/DataDownload/default.aspx' };
const ACS = { label: 'US Census ACS 2024 5-year', url: 'https://data.census.gov/' };
const OSM = { label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/' };

const USE_TEXT = { sports_facility: 'a sports facility' };
function useLabel(project) {
  const other = (project.spec.pending ?? []).find((x) => x.key === 'other_use_zoning')?.value;
  if (!checksSportsZoning(project.spec)) return other ? other.replace(/^zoning that allows /i, '') : 'your use';
  const u = project.spec.uses?.[0]?.use ?? 'sports_facility';
  return USE_TEXT[u] ?? u.replace(/_/g, ' ');
}
const titleCase = (s) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const yrs = (n) => `${Math.floor(n)} year${Math.floor(n) === 1 ? '' : 's'}`;

async function datasetDates() {
  const rows = await all('SELECT name, imported_at FROM dataset_meta');
  return Object.fromEntries(rows.map((r) => [r.name, r.imported_at]));
}

// ---------- 1. What is this land? ----------
function parcelFinding(c, d) {
  return {
    key: 'parcel', label: 'Parcel', verdict: 'neutral', basis: 'known',
    finding: `${c.acres != null ? c.acres.toFixed(1) + ' acres' : 'Size unknown'}${c.address ? ` at ${c.address}` : c.address_near ? ` near ${c.address_near} (no street address)` : ''}, parcel ${c.pin.slice(0, 6)}-${c.pin.slice(6)}.`,
    detail: c.present_use ? `Assessor's present use: ${c.present_use}.` : null,
    sources: [{ ...GIS(c), asOf: d.candidates }],
  };
}

function jurisdictionFinding(c, d) {
  const inCity = Boolean(c.city);
  return {
    key: 'jurisdiction', label: 'Jurisdiction', verdict: 'neutral', basis: 'known',
    finding: inCity ? `Inside the City of ${titleCase(c.city)}. City zoning, permits and council apply.`
      : `Unincorporated ${countyName(c)}${c.postal_city ? ` (${titleCase(c.postal_city)} area)` : ''}. County zoning, permits and council apply.`,
    sources: [{ ...GIS(c), asOf: d.candidates }],
  };
}

function siteFinding(c, d) {
  const tags = c.tags ?? [];
  const live = (c.businesses ?? []).filter((b) => b.status !== 'closing');
  const src = [{ ...ASSESSOR(c), asOf: d.candidates }, ...(c.businesses?.length ? [OSM] : [])];
  if (tags.includes('vacant-land')) return { key: 'site', label: "What's on the site", verdict: 'favorable', basis: 'known', finding: 'Vacant land: the assessor records no meaningful building.', sources: src };
  if (tags.includes('anchor-tenant')) return { key: 'site', label: "What's on the site", verdict: 'unfavorable', basis: 'known', finding: `A major anchor tenant operates here (${live.map((b) => b.label).slice(0, 3).join(', ')}).`, sources: src, dealBreaker: true };
  if (tags.includes('closing-tenant')) return { key: 'site', label: "What's on the site", verdict: 'favorable', basis: 'likely', finding: 'A tenant on site is closing or marked closed: a possible opening to buy.', sources: src, check: 'Confirm the tenant has left and when the lease ends.' };
  if (tags.includes('operating-business')) return { key: 'site', label: "What's on the site", verdict: 'unfavorable', basis: 'likely', finding: `A business appears to operate here${live.length ? ` (${live.map((b) => b.label).slice(0, 3).join(', ')})` : ''}.`, sources: src, check: 'Find out whether the business owns or leases, and when the lease ends.' };
  if (tags.includes('possible-empty-building')) return { key: 'site', label: "What's on the site", verdict: 'favorable', basis: 'likely', finding: 'A commercial building with little recorded value: it may be empty.', sources: src, check: 'Drive by or check imagery to see whether the building is in use.' };
  const imprPerAcre = c.impr_value != null && c.acres ? c.impr_value / c.acres : null;
  return {
    key: 'site', label: "What's on the site", verdict: imprPerAcre != null && imprPerAcre < 10000 ? 'favorable' : 'neutral', basis: 'likely',
    finding: imprPerAcre != null ? `Buildings are assessed at ${money(c.impr_value)} (${money(imprPerAcre)} per acre)${imprPerAcre < 10000 ? ': mostly land value' : ''}.` : 'No building value on record.',
    sources: src,
  };
}

function ownerFinding(c, own, d) {
  const type = { individual: 'an individual', trust: 'a trust', llc: 'an LLC', company: 'a company', government: 'a government body' }[c.owner_type] ?? null;
  const parts = [];
  if (type) parts.push(`Owned by ${type}`);
  if (c.years_held != null) parts.push(`held ${yrs(c.years_held)} since the last ${isKing(c) ? 'market sale' : 'recorded deed'}`);
  else if (own?.records === 0) parts.push('no recorded sales');
  if (c.out_of_state) parts.push('the tax bill goes out of state');
  else if (c.absentee) parts.push('the owner mails from another city');
  const last = own?.lastTransfer;
  const signals = (c.signals ?? []).filter((s) => !/tax program|mostly land/.test(s));
  return {
    key: 'owner', label: 'Ownership', verdict: c.years_held >= 20 || c.out_of_state || /inherit|trust/.test(signals.join(' ')) ? 'favorable' : 'neutral',
    basis: 'known',
    finding: parts.length ? parts.join('; ') + '.' : 'Ownership details are not on record.',
    detail: last ? `Last transfer ${last.date?.slice(0, 10) ?? ''}: ${last.kind}${last.price ? ` for ${money(last.price)}` : ''}${last.buyer ? ` to ${last.buyer}` : ''}.` : null,
    sources: isKing(c) ? [{ ...KC_SALES, asOf: d.kc_sales }, { ...ASSESSOR(c), asOf: d.candidates }] : [{ ...ASSESSOR(c), asOf: d.candidates }],
    check: c.owner_type === 'llc' || c.owner_type === 'trust' ? 'Look up who is behind the LLC or trust in the state business registry.' : null,
  };
}

function ownerSituationFinding(c, d) {
  const cu = c.current_use;
  if (cu) {
    return {
      key: 'owner_situation', label: "Owner's situation", verdict: 'neutral', basis: 'known',
      finding: `In the ${cu.toLowerCase()} tax program: leaving it triggers rollback taxes (years of back taxes). That cost should be priced into any offer.`,
      sources: [{ ...ASSESSOR(c), asOf: d.candidates }],
      check: 'Ask the assessor for the rollback amount. Tax delinquency, liens and probate are not checked yet.',
    };
  }
  return {
    key: 'owner_situation', label: "Owner's situation", verdict: 'unknown', basis: 'unknown',
    finding: 'Not checked yet: tax delinquency, liens, loans coming due, probate and listing history.',
    sources: [], check: `Check the ${countyName(c)} treasurer for delinquent taxes and the auditor's recorded documents and courts for liens or probate.`,
  };
}

const unknown = (key, label, finding, check) => ({ key, label, verdict: 'unknown', basis: 'unknown', finding, sources: [], check });

// ---------- 2. Can you build it here? ----------
// Zoning verdicts exist for sports facilities only. A project gets them only when its criteria actually check
// that zoning; any other project (agritourism, housing…) is told its use hasn't been read, never shown sports rules.
const checksSportsZoning = (spec) => [...spec.requirements, ...spec.preferences].some((x) => x.field === 'zoning.sports_facility');

function zoningFindings(c, project, d) {
  const useText = useLabel(project);
  const zone = c.zoning ? `Zone ${c.zoning}` : 'No zone on record';
  const place = c.city ? titleCase(c.city) : countyName(c);
  if (!checksSportsZoning(project.spec)) {
    return [
      unknown('zoning', 'Zoning', `${zone}. Paydirt hasn't read ${place}'s rules for ${useText} yet.`, `Read ${place}'s use table for ${useText}, or request it on the Areas page.`),
      unknown('entitlement', 'Entitlement path', 'Unknown until the zoning rules are read.', null),
    ];
  }
  const v = c.sports_verdict ?? 'unknown', read = c.zoning_basis === 'read';
  const src = c.zoning_source ? [{ label: `${place} zoning code`, url: c.zoning_source }] : !c.city && isKing(c) ? [{ label: 'King County Code Title 21A', url: KC_CODE_SOURCE }] : [];
  const zoning = {
    key: 'zoning', label: 'Zoning', basis: v === 'unknown' ? 'unknown' : read ? 'likely' : 'known',
    verdict: { permitted: 'favorable', conditional: 'neutral', prohibited: 'unfavorable', unknown: 'unknown' }[v],
    finding: `${zone}${c.zone_name ? ` (${c.zone_name})` : ''}. ${c.sports_note ?? ''}`.trim(),
    sources: src, dealBreaker: v === 'prohibited',
    check: v === 'unknown' ? `Paydirt hasn't read ${place}'s rules for this zone. ${c.zoning && !isKing(c) ? "Read them from the site's Zoning section" : 'Request it on the Areas page'}, or call ${place} planning.` : read ? `Paydirt read this from ${place}'s code and no person has checked it yet. Open the source and confirm with planning before relying on it.` : 'Confirm with the planning department before relying on this; codes change.',
  };
  const path = {
    permitted: ['favorable', 'Allowed outright: a building permit, no hearing. Development conditions can still apply.'],
    conditional: ['neutral', 'Needs a conditional use permit or other discretionary approval: typically a public hearing and several months.'],
    prohibited: ['unfavorable', 'Not allowed in this zone: it would need a rezone, which is slow and uncertain.'],
    unknown: ['unknown', 'Unknown until the zoning rules for this zone are read.'],
  }[v];
  const entitlement = { key: 'entitlement', label: 'Entitlement path', verdict: path[0], basis: v === 'unknown' ? 'unknown' : 'likely', finding: path[1], sources: src, dealBreaker: v === 'prohibited',
    check: v === 'conditional' ? 'Ask planning for typical timeline and cost, and whether a pre-application meeting is offered.' : null };
  return [zoning, entitlement];
}

// ---------- 4. Does it pencil? (what we hold today) ----------
function demandFinding(c, d) {
  if (c.hh200k_10mi == null) return unknown('demand', 'Demand nearby', `Census income data isn't loaded for ${countyName(c)} yet.`, null);
  return {
    key: 'demand', label: 'Demand nearby', verdict: c.hh200k_10mi >= 60000 ? 'favorable' : c.hh200k_10mi >= 30000 ? 'neutral' : 'unfavorable', basis: 'known',
    finding: `${Math.round(c.hh200k_10mi).toLocaleString('en-US')} households earning $200k+ within 10 miles${c.share200k_10mi != null ? ` (${Math.round(c.share200k_10mi * 100)}% of households)` : ''}${c.kids_share_10mi != null ? `; ${Math.round(c.kids_share_10mi * 100)}% have children` : ''}.`,
    sources: [{ ...ACS, asOf: d.acs }],
  };
}

function landCostFinding(c, d) {
  if (c.land_value == null) return unknown('land_cost', 'Land cost', 'No assessed land value on record.', null);
  return {
    key: 'land_cost', label: 'Land cost', verdict: 'neutral', basis: 'known',
    finding: `Land assessed at ${money(c.land_value)}${c.acres ? ` (${money(c.land_value / c.acres)} per acre)` : ''}. Assessed value is a floor, not a price.`,
    sources: [{ ...ASSESSOR(c), asOf: d.candidates }],
    check: 'Pull comparable land sales nearby before naming a price.',
  };
}

// ---------- The statement ----------
const OVERALL = {
  no: 'Doesn’t fit',
  conditions: 'Fits with conditions',
  strong: 'Strong fit',
  evidence: 'Not enough evidence',
};

export async function fitStatement(project, c) {
  const d = await datasetDates();
  const own = isKing(c) ? await ownershipFor(c.pin) : null; // sales history is loaded for King County only
  const [zoning, entitlement] = zoningFindings(c, project, d);
  const sections = [
    { key: 'land', title: 'What is this land?', findings: [
      parcelFinding(c, d), jurisdictionFinding(c, d), siteFinding(c, d), ownerFinding(c, own, d), ownerSituationFinding(c, d),
      unknown('title', 'Title and legal', 'Not checked yet: easements, covenants, deed restrictions, legal access, leases and water rights.', `Order a preliminary title report, or search ${countyName(c)} recorded documents for this parcel.`),
      unknown('physical', 'Physical constraints', 'Not checked yet: slope, floodplain, wetlands and soils.', `Check ${countyName(c)}'s critical-areas maps and FEMA flood maps.`),
      unknown('utilities', 'Utilities and access', 'Not checked yet: sewer, water and power availability, and road access.', 'Ask the local water and sewer district for availability; confirm legal road access.'),
    ] },
    { key: 'build', title: 'Can you build it here?', findings: [zoning, entitlement] },
    { key: 'people', title: 'Will they let you?', later: true, findings: [
      unknown('government', 'Local government appetite', 'Not assessed yet: plans, council record and approvals of similar projects.', null),
      unknown('community', 'Community appetite', 'Not assessed yet: public comment and appeals on similar projects.', null),
    ] },
    { key: 'market', title: 'Does it pencil?', findings: [
      demandFinding(c, d), landCostFinding(c, d),
      unknown('competition', 'Competition', 'Not assessed yet: similar facilities nearby and ones in permitting.', null),
      unknown('incentives', 'Tax incentives', 'Not assessed yet: Opportunity Zones and state or local programs.', null),
    ] },
  ];

  // Criteria the project's Must chips would fail are deal-breakers for this project.
  const criteriaFails = (c.hiddenBecause ?? []).filter((_, i) => c.hiddenFields?.[i] !== 'excluded');
  const all = sections.flatMap((s) => s.findings);
  const dealBreakers = [
    ...all.filter((f) => f.dealBreaker).map((f) => ({ label: f.label, text: f.finding })),
    ...criteriaFails.map((r) => ({ label: 'Your criteria', text: `Fails a Must: ${r}.` })),
    ...(c.excluded ? [{ label: 'Excluded', text: `Hidden from every search: ${c.excluded}.` }] : []),
  ];
  const conditions = all.filter((f) => !f.dealBreaker && f.verdict === 'neutral' && ['entitlement', 'owner_situation'].includes(f.key)).map((f) => ({ label: f.label, text: f.finding }));
  const core = [...sections[0].findings, ...sections[1].findings];
  const knownCore = core.filter((f) => f.basis !== 'unknown').length;

  let overall;
  if (dealBreakers.length) overall = 'no';
  else if (zoning.verdict === 'unknown') overall = 'evidence';
  else if (conditions.length || zoning.verdict === 'neutral') overall = 'conditions';
  else overall = 'strong';

  return {
    project: { id: project.id, name: project.name, version: project.spec_version },
    use: useLabel(project),
    site: { pin: c.pin, property_uid: c.property_uid, address: c.address, address_near: c.address_near, county_fips: c.county_fips, city: c.city, postal_city: c.postal_city, acres: c.acres, zoning: c.zoning, score: c.score, saved: c.saved, status: c.status, lat: c.lat, lng: c.lng },
    // "Strong fit" is only claimed outright when nothing core is unchecked.
    overall: { key: overall, label: overall === 'strong' && knownCore < core.length ? 'Strong fit so far' : OVERALL[overall] },
    argument: argument(overall, c, zoning, dealBreakers, conditions, all),
    dealBreakers, conditions, sections,
    // Web research is shown apart from the findings: unverified, with its sources, never part of the verdict.
    web: await latestResearch(c.pin), researchCredits: RESEARCH_CREDITS,
    diligence: all.filter((f) => f.check).map((f) => ({ label: f.label, text: f.check, unknown: f.basis === 'unknown' })),
    coverage: { known: knownCore, total: core.length },
    generatedAt: new Date().toISOString(),
  };
}

// The argument paragraph is assembled only from findings, so it can never claim more than the evidence does.
function argument(overall, c, zoning, dealBreakers, conditions, all) {
  const where = c.city ? titleCase(c.city) : `unincorporated ${countyName(c)}${c.postal_city ? ` near ${titleCase(c.postal_city)}` : ''}`;
  const size = c.acres != null ? `${c.acres.toFixed(1)} acres` : 'This site';
  const good = all.filter((f) => f.verdict === 'favorable' && !['zoning', 'entitlement'].includes(f.key)).map((f) => f.finding.split(':')[0].replace(/\.$/, '').replace(/^./, (x) => x.toLowerCase()));
  const lines = [];
  if (overall === 'no') lines.push(`${size} in ${where}, but it doesn't work for this project: ${dealBreakers.map((b) => b.text.replace(/\.$/, '')).join('; ')}.`);
  else if (overall === 'evidence') lines.push(`${size} in ${where}. Whether this use is allowed here is still unknown, so Paydirt can't argue for it yet.`);
  else if (overall === 'strong') lines.push(`${size} in ${where}, and the use is allowed outright.`);
  else lines.push(`${size} in ${where}. It can work, with conditions: ${[...(zoning.verdict === 'neutral' ? ['the use needs a conditional use permit'] : []), ...conditions.filter((x) => x.label !== 'Entitlement path').map((x) => x.text.split(':')[0].toLowerCase())].join('; ')}.`);
  if (good.length && overall !== 'no') lines.push(`In its favor: ${good.slice(0, 3).join('; ')}.`);
  const unknowns = all.filter((f) => f.basis === 'unknown').length;
  if (unknowns) lines.push(`${unknowns} items are not checked yet; they are listed as due diligence below.`);
  return lines.join(' ');
}
