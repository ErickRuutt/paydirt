# The fit statement

Status: direction, not a plan. Captured 2026-11-22 from a design conversation. Nothing here is built yet.

## Why it matters

The fit statement is Paydirt's argument for buying and building on a specific site, and why. Developers pay for it and act on it. Everything else in the product exists to produce good ones.

Paydirt's customers are any developer looking for land for a project: a gas station, a housing development, an agritourism farm in Hood River. Field House is the first.

**Accuracy comes before speed.** A thorough analysis can take minutes or hours. A wrong statement can't be undone by making it fast.

**Paydirt is a research tool first.** It finds land and argues whether it fits. Running the deal afterward (cost estimates, financing, closing, project tasks) is handled elsewhere. Becoming a real estate project-management tool is out of scope unless the market pushes for it.

## Two different jobs

| | Filtering and ranking | Project analysis |
|---|---|---|
| Purpose | Get from every parcel in a market to a shortlist without wrongly dropping a good site | Decide whether a shortlisted site works, and argue it |
| Runs on | Every parcel in the market (millions down to hundreds) | A shortlist of about 10–50 sites |
| How | SQL over the search table, compiled from the project's criteria | Background job that reads sources beyond the database |
| Speed | Seconds | Minutes to hours; notifies when done |
| Missing data | Shown as "not checked yet", never as a fail | Becomes a due-diligence item |
| Output | Ranked list on the map | A fit statement per site, plus a comparison of finalists |

What the analysis learns (a verified zoning verdict, a confirmed sewer connection) is written back to the database as sourced facts. That way every analysis makes the next filter more accurate.

## What a fit statement answers

Four questions, each with its own kind of evidence. Difficulty is for national scale.

### 1. What is this land? (facts)

| Dimension | Evidence | Difficulty |
|---|---|---|
| Parcel tracking | County assessor, parcel data vendors | Easy per county; national coverage takes work |
| Ownership | Assessor; state business registries to identify the real person behind LLCs and trusts | Medium |
| Incorporated vs unincorporated | City boundary files (Census) | Easy. It decides which government, zoning code, taxes and utilities apply |
| Vacancy on the site | Assessor use codes, imagery, business listings | Medium |
| Physical constraints | Slope, floodplain, wetlands, soils, contamination history | Medium |
| Utilities and access | Sewer, water and power availability and capacity; road frontage; traffic counts | Hard; often a deal-breaker |
| Title and legal | Easements, covenants and deed restrictions (a covenant can ban a use that zoning allows); legal access (frontage isn't always a legal right to use it); leases that survive a sale (farm, cell tower, billboard); mineral and water rights split from the land. Evidence: county recorder documents, title records, state water-rights databases | Medium–hard |
| Owner situation | Distress (tax delinquency, liens, loans coming due, pre-foreclosure); estates, probate and the number of heirs or partners who must agree; listing history (past listings, price cuts, time on market); rollback taxes owed when land leaves a farm or open-space tax program. Evidence: treasurer and recorder records, court records, listing history, assessor tax-program flags | Medium |

### 2. Can you build it here? (rules)

| Dimension | Evidence | Difficulty |
|---|---|---|
| Zoning | Municipal code text and zoning maps; a verdict per use | Hard at scale (~30,000 jurisdictions) |
| Entitlement path | Allowed outright, conditional use permit, or rezone; typical timeline and cost | Hard; developers weigh it as much as the verdict |

### 3. Will they let you? (people)

| Dimension | Evidence | Difficulty |
|---|---|---|
| Local government appetite | Comprehensive plan and future land use map; council and planning commission agendas and minutes (e.g. Legistar); approval rates and timelines for similar projects; moratoria; planned infrastructure investment | Hardest |
| Community appetite | Public comment at hearings; appeals of similar projects; local news; neighborhood groups; ballot measures | Hardest and most subjective |

These two are the most valuable and what other tools don't offer. Listing sites and parcel tools stop at facts and zoning. "This city approves projects like yours, and here's the record" is the reason to buy Paydirt. This ties to the development-tracking vision (SEPA, Legistar, permits) in `product-notes.md`.

### 4. Does it pencil? (market)

| Dimension | Evidence | Difficulty |
|---|---|---|
| Competition | Existing businesses of that type; permits for ones under construction | Medium; specific to each use |
| Tax incentives | Opportunity Zones, state enterprise zones, local abatements, LIHTC (housing), farm tax programs | Medium; rules change, so each needs a date |
| Market vacancy | Vacancy rates for that property type in the area (different from vacancy on the site) | Medium; often paid data |
| Demand | Population and income growth; who lives within drive time | Medium |
| Land cost | Assessed value, comparable sales, listing price if listed | Medium |

### Build order and scope (decided 2026-11-22)

**Questions 1 and 2 are the core problems Paydirt solves, and they come first.** Title and legal and the owner's situation (from a broker's view) are part of question 1. Questions 3 and 4 stay in scope and follow.

**Later, maybe:** where the area is heading.
- Who owns the neighboring parcels, and could they be combined?
- What's in permitting nearby that would compete?
- Planned roads, interchanges, transit and schools.
- Political timing: elections, comprehensive plan updates, pending code changes.
- Incompatible neighbors.

**Out of scope (handled elsewhere):**
- True site cost: usable acres, impact fees, utility extensions, environmental history, insurability.
- Financing and exit: lender appetite, appraisal comparables, absorption.
- Next-step actions and who to call.

## Rules for every statement

1. **Each dimension gets a verdict, evidence and a confidence.** The verdict is favorable, neutral, unfavorable or unknown. Evidence includes the source and its date. A claim with no source doesn't go in.
2. **Known, likely and unknown are kept separate.** An inference is never presented as a fact.
3. **Deal-breakers come first.** "Allowed with a conditional use permit, but the council denied two similar projects last year" goes at the top.
4. **Unknowns become the due-diligence list:** what to verify before contacting the owner, and how.
5. **Weighting depends on the use.**
   - Gas station: competition and traffic dominate.
   - Housing: government appetite, density and sewer.
   - Agritourism: farm-zoning rules and the neighbors.

   The use template decides which dimensions count and by how much.

## Data direction (open ideas, not decisions)

- **Store facts about land; derive everything else.** Layers:
  1. Parcel core: `properties`, made national, with real geometry (PostGIS).
  2. Facts by subject, each with a source and an as-of date. Possibly entity-attribute-value rows: one row per parcel per fact.
  3. Area context, such as census data, points of interest and drive times.
  4. Interpretations that can always be recomputed: zoning verdicts per use, likely-to-sell signals, tags.
  5. Projects.
- **Search table per market.** Wide, typed and indexed, rebuilt from the facts. Today's `candidates` is a hard-coded version of this.
- **Attribute catalog.** Each filterable fact is registered with its type, unit, source, how it compiles to SQL, and which counties have it. New attributes start in the flexible layer and are promoted to the search table when projects use them.
- **Use catalog.** A standard list of uses (for example the APA's Land-Based Classification Standards, trimmed), each with a criteria template. This turns an unstructured brief into structured criteria. The AI picks and adjusts from the templates; it doesn't invent criteria.
- **"Not checked yet" counts form the data roadmap.** What projects ask for and the data can't answer shows what to acquire next.
- **Agents own data areas at ingestion, not at query time.** Areas such as zoning, ownership, utilities and traffic. Each maps messy sources into the catalog and flags what it can't place.
- **Decision models for classification steps.** Jev (TypeSafe AI) returns a choice, score or yes/no with a calibrated confidence. It is a candidate for:
  - zoning text → verdict
  - brief → use
  - vendor field → catalog attribute

  Confident answers would be accepted, and uncertain ones sent to a stronger model or a person. It needs testing on Paydirt's own verified cases first, and it means sending text to another vendor.
- **Load by market, not by country.** There are about 150M US parcels.

## Open questions

- What does a great fit statement look like? Write one by hand for three very different projects (gas station, housing development, Hood River agritourism) and work back to the data each needs.
- Which dimensions are in the first version, and which are marked "not assessed"?
- How is government and community appetite scored without it becoming opinion? What counts as evidence, and how recent does it need to be?
- Which markets come next, and what does launching a market include (parcels, zoning rules for the top uses, boundaries, incentives)?
- Where does the deep analysis fit in pricing (`product-notes.md`: buy an area, pay for depth)?
