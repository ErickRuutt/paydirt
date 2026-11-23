# Data tools research

Internal research note, 2026-11-22. Research only: no accounts were created and no keys entered. Every claim links to the vendor page it came from, read on 2026-11-22. **Unverified** means the vendor's public pages don't say. Pricing is quoted as shown; where a price isn't public it says so. Not legal advice: the licensing readings below need a lawyer before Paydirt relies on them.

Context: what a fit statement needs is in [fit-statement.md](fit-statement.md); today's data and the credits model are in [product-notes.md](product-notes.md).

## Comparison

| Tool | What it is | WA coverage (King / Clallam) | Fit-statement areas | Price (public) | Can Paydirt store, show and resell it? | Verdict |
|---|---|---|---|---|---|---|
| **Regrid** | National parcel API + county files | **Yes / Yes** (counts and fill rates published) | Parcels, ownership, zoning code + standardized zoning, sales, footprints | API: 2,000 records/mo included, overage $0.10 (Standard) / $0.15 (Premium) per record; plan and county prices not public | API records may be stored (with conditions); store files: 1-year license, no "making available to third parties" | **Try first** (parcel backbone + zoning for new counties) |
| **West Kite** | National property data API (records, owners, zoning, permits, site reports) | Unverified (coverage endpoint needs a key) | Ownership + owner research, zoning districts, permits, distress, site report | Free $15 credit; $49 / $199 / $349 per month; per-unit list prices | **No API data license found** | **Try second**, after a free coverage check and a license answer |
| **Repliers** | MLS listings API | NWMLS supported; land listings unverified | Listings / for sale, listing history | $0 sample tier; $199–$399/mo per MLS | Only via an MLS license; no bulk storage; no resale | **Hold**: depends on the NWMLS broker path |
| **Apify** | Scraping platform + third-party scrapers | n/a (depends on target site) | Listings (scraped), council minutes, news | Free $5/mo; $19 / $199 / $999 per month | Apify puts all legal risk on the user | **Narrow use only**: public-government pages, not listing sites |
| **GA4** | Product analytics (for Paydirt's own app) | n/a | none (product analytics) | Free | n/a (no personal data may be sent) | **Fine, low priority** |
| **Urbanum** | Office/industrial listings and market data | Seattle office yes; Clallam no; land no | Market vacancy (office/industrial) | Free; $149/mo; Team/Enterprise not public | Site terms: non-commercial, no redistribution | **Skip** |
| **CRE Terminal** | AI underwriting for a firm's own deals | Unverified | Some comps; not parcels/zoning/listings | Not public (request access) | No terms published | **Skip** |
| **"Land takeoffs"** (TestFit, STACK, Attentive.ai) | Site test-fit / contractor takeoff | n/a | Yield and earthwork (mostly out of scope) | TestFit $75/user/mo to $15k+/yr; STACK $299+/user/mo | No resale API | **Skip for now**; revisit TestFit if "true site cost" comes into scope |

---

## 1. Regrid (parcel data API)

**What it does.** National parcel data with boundaries, owners, addresses, land use, zoning and building footprints, via API, map tiles and bulk files. The schema has 14 field categories, each tagged "Premium & Standard" or "Premium only" ([schema](https://support.regrid.com/parcel-data/schema)).
- Zoning: local `zoning` code in both tiers; standardized `zoning_type` and `zoning_subtype` are Premium only and sourced from Zoneomics ([land use & zoning](https://support.regrid.com/docs/land-use-zoning)). The zoning product page lists permitted and conditional uses, height, FAR, setbacks and lot coverage, and a link to the ordinance ([zoning](https://regrid.com/zoning)).
- Standardized land use (LBCS fields) is Premium only ([schema](https://support.regrid.com/parcel-data/schema)).
- Add-ons: matched building footprints, daily ownership updates ([API](https://regrid.com/api), [ownership](https://regrid.com/enhanced-property-ownership)).

**Coverage.**
- National: "160M+" parcels, 3,229+ counties, 144M+ parcels with standardized zoning ([store](https://app.regrid.com/store), [API](https://regrid.com/api)).
- Washington: all 39 counties online, 3,300,492 parcels ([WA store](https://app.regrid.com/store/us/wa)).
- **King:** 636,721 parcels, refreshed 2026-10-28; zoning code 100%, owner name 96%, last sale price 85%, total value 98%; standardized zoning on 634,911 parcels ([King](https://app.regrid.com/store/us/wa/king)). Note King's owner name at 96% even though King strips owner names from its own bulk files (product-notes) — worth checking where Regrid gets them.
- **Clallam:** 54,553 parcels, refreshed 2026-08-19; zoning code 100%, owner name 91%, last sale price 46% ([Clallam](https://app.regrid.com/store/us/wa/clallam)).

**API.** REST on `app.regrid.com`, token parameter, GeoJSON responses; search by point/radius, address, APN, owner, polygon, and `/parcels/query` with up to 4 field filters; `limit` up to 1,000; about 200 requests/minute and 10 at once; async batch up to 100,000 points ([getting started](https://support.regrid.com/docs/getting-started-api), [API](https://regrid.com/api)). Raster and vector tiles ([API terms](https://regrid.com/terms/api)). Bulk files in CSV, GeoPackage, Parquet, SQL and others ([pricing](https://regrid.com/pricing)).

**Pricing.**
- Monthly API plans include 2,000 parcel records and 200,000 tiles; extra records $0.10 (Standard) or $0.15 (Premium) each; tiles $0.001. Billed per record returned; empty responses free; repeats billed again ([getting started](https://support.regrid.com/docs/getting-started-api)).
- Base plan price: **unverified** (not shown on [plans](https://app.regrid.com/api/plans) or [pricing](https://regrid.com/pricing)).
- County file prices: **unverified** (not shown on the King or Clallam pages). Bulk/nationwide: contact sales.
- 30-day free sandbox ([API](https://regrid.com/api)).

**Terms.**
- API: may integrate data "into Customer's apps, products, and services" and combine with other data providers; may cache or store API records but must destroy them on termination; no sublicensing or distributing to third parties; no building a product that re-creates a Regrid product ([API terms](https://regrid.com/terms/api)). The docs separately say data "can be cached for up to 30 days" ([getting started](https://support.regrid.com/docs/getting-started-api)) — the two conflict.
- Tiles and bulk data: no offline storage without written approval ([API terms](https://regrid.com/terms/api)).
- Store files: one-time export, 1-year term then delete; no reselling, sublicensing or "otherwise making the Data available to third parties"; customers may view parcel polygons on maps if they can't extract a substantial copy; link to regrid.com on each page that uses it ([store license](https://app.regrid.com/store/license)).
- No AI training on the data except internal models ([terms](https://regrid.com/terms)).

**Fit for Paydirt.**
- Parcels (Q1): replaces the per-county GIS adapter for new counties; one schema nationwide.
- Ownership (Q1): owner name and mailing address; does not resolve LLCs to people.
- Zoning (Q2): a zoning *code* and standardized *type* everywhere, plus permitted uses where Zoneomics has them. Gives the filter a first pass ("not checked yet" becomes "likely"). Not a verdict: it still needs reading against the use, and assessor codes lag rezones.
- Land cost (Q4): value and last sale where the county publishes them (85% King, 46% Clallam).
- Doesn't cover: listings, permits, government/community appetite, physical constraints beyond what's tagged.

**Compared with today.** King and Clallam are already free from county GIS, so Regrid adds little there except standardized zoning and owner names. Its value is in the **next** counties (no adapter per county) and in zoning outside the ~13 hand-read cities.

**Risks.**
- Licensing vs. the credits model: unlocking a county is "making the data available" to a customer. The API terms' "integrate into apps, products and services" helps; the store license does not. Needs written confirmation that per-customer display in a SaaS is allowed and what happens to cached data if Paydirt leaves.
- Cost: $0.10–0.15 per record makes a whole-county API pull expensive (King's 21k parcels of 5+ acres ≈ $2,100–3,200 at overage rates); county files or a bulk license are the realistic route, at unpublished prices.
- Mireye comparison: Mireye Search is $0.20 per query for up to 100 parcels; Regrid bills per record. Mireye Enrich ($0.02/parcel: slope, flood, wetlands) is a different layer Regrid doesn't replace.

## 2. West Kite (westkite.com/api)

**What it does.** "US real estate data through one API": property records, ownership, zoning, permits and geospatial insights for 141M properties, each fact with its source; API, MCP server, CLI and dashboard ([home](https://westkite.com)).
- Categories ([data](https://westkite.com/data.md)): parcels and owners of record from assessors; assessments and tax; recorded sales; building permits; parcel zoning code and city planning records where published; zoning districts from city and county maps ("over 5,000 cities and counties"); tax delinquency (a few named counties, none in WA); owner research through deeds, state registries, SEC filings and the web; owner contact info; loans (CMBS, HUD, mortgages, SBA); flood, wetlands, contamination, hazards and incentives in a site report; utilities and transport; Census demographics.
- "Listings" is a `find` type but nothing documents what it returns — **unverified** ([API](https://westkite.com/api), [changes](https://westkite.com/docs/api/changes.md)).
- Every source carries licence fields (`status`, `redistribution`, `attribution`, values like `open`, `unclear`, `permission`, `paid`) ([sources](https://westkite.com/docs/api/sources.md)). Useful for Paydirt's "every claim has a source" rule.

**Coverage.** 141M properties across 2,609 counties ([home](https://westkite.com)). "A county not listed is not covered yet," and the list comes from `GET /v1/coverage`, which needs a key ([coverage](https://westkite.com/docs/api/coverage.md)). **King and Clallam coverage, and which fields exist there: unverified.**

**API.** REST/JSON at `api.westkite.com/v1`, OpenAPI 3.1, `Authorization: Bearer <key>` ([API](https://westkite.com/api), [docs](https://westkite.com/docs/api.md)). Rate limits 30 / 300 / 1,000 / 2,000 requests a minute by plan. Exports up to 100,000 rows as CSV or NDJSON, link valid 24 hours ([exports](https://westkite.com/docs/api/exports.md)). Per-call and monthly spend caps ([docs](https://westkite.com/docs/api.md)). Endpoints were replaced on 2026-11-22 ([changes](https://westkite.com/docs/api/changes.md)) — the API is young and moving.

**Pricing** ([pricing](https://westkite.com/pricing.md), [API pricing](https://westkite.com/docs/api/pricing.md)).
- Free $0 with $15 credit; Starter $49/mo; Growth $199/mo; Pro $349/mo (half price on everything); Enterprise "talk to us". Plan fees count as included usage.
- List prices: search, counts, catalog free; find rows $1 per 1,000; property records $10 per 1,000 (the [API page](https://westkite.com/api) says $0.01 per record — same thing); site/demographics report $0.05 each; owner research $0.10 per property; owner email $0.50, phone $1 per one found. Failed lookups free; credit never expires.

**Terms.** **No API data license found.** The only legal page is the website [terms](https://westkite.com/terms), which bars republishing, selling or making derivative works from "site content" and doesn't say whether that covers API output. `/docs/api/terms.md`, `/api-terms` and `/legal` don't exist. API and enterprise agreements are "arranged by contacting the team" ([support](https://westkite.com/support)).

**Fit for Paydirt.**
- Ownership and owner situation (Q1): owner research through state registries is the "real person behind the LLC" item the fit statement calls medium difficulty. $0.10 a property suits a shortlist (10–50 sites).
- Zoning (Q2): zoning districts from city maps, a second source to check assessor codes that lag rezones.
- Permits (Q3/Q4): building permits for competition and "what's being built nearby".
- Physical constraints and incentives (Q1/Q4): site report at $0.05 — overlaps Mireye Enrich ($0.02) and adds incentives.
- Pricing shape (per record, per report, spend caps, MCP) matches Paydirt's credits and spend-guard model.

**Risks.** No storage or resale terms; young API with breaking changes; WA coverage unknown; contact data on private owners raises the privacy issues already flagged in product-notes (intel network).

## 3. Repliers (MLS listings API)

**What it does.** Normalized MLS listing data: search, photos, history and comparables, sold data where the MLS allows, saved searches, alerts, webhooks, AI search, an MCP server; add-ons for estimates, public record and parcel data, archived history ([home](https://repliers.com/), [docs](https://docs.repliers.io/)). Listing classes documented: condo, residential, commercial, with lot-size filters ([listings reference](https://docs.repliers.io/reference/getting-started-with-your-api)). **Land/vacant-lot coverage: unverified.**

**Coverage.** 500+ MLSs ([pricing](https://repliers.com/plans-and-pricing/)). **NWMLS is supported** "from $199/month" ([NWMLS page](https://repliers.com/mls-directory/washington/northwest-multiple-listing-service)). Olympic MLS (Clallam area) is also listed ([MLS directory](https://repliers.com/mls-directory/)). Property types and sold-history depth for NWMLS: unverified.

**API.** REST/JSON, header `REPLIERS-API-KEY`, OpenAPI 3.1 ([docs](https://docs.repliers.io/)). 1M requests/month per dataset included; rate limit not numeric ([terms §7](https://help.repliers.com/en/article/our-terms-of-service-tj6vjm/)). Webhooks only on Preview and Advanced ([pricing](https://repliers.com/plans-and-pricing/)). No bulk replication without written approval ([terms §4.3](https://help.repliers.com/en/article/our-terms-of-service-tj6vjm/)).

**Pricing** ([pricing](https://repliers.com/plans-and-pricing/)). Preview $0 (sample data only); Standard $199/mo; Professional $299/mo; Advanced $399/mo (annual: $182 / $275 / $365). Plans cover one MLS. Add-ons: Public Record & Parcel Data $199, Archived Data $149, Estimates $149. No setup fee; but new MLS datasets carry a one-year minimum and fees are non-refundable ([terms §7–8](https://help.repliers.com/en/article/our-terms-of-service-tj6vjm/)).

**Terms and MLS rules.**
- Only real estate professionals, or vendors they hire, may use it; vendors usually need their own MLS data license; the broker of record signs ([access requirements](https://help.repliers.com/en/article/mls-data-access-requirements-who-can-use-mls-apis-wyl8lw/)).
- Data is for "the Subscriber's internal use and … registered clients"; no resale, sublicensing or redistribution; no local storage without written authorization; no training AI or building a competing product; IDX/VOW rules and board compliance review apply ([terms §3–4](https://help.repliers.com/en/article/our-terms-of-service-tj6vjm/)).
- A subscription can't serve brokers not named on it (§4.9).

**Fit for Paydirt.** Fills "for sale / listing price / listing history" (Q1 owner situation, Q4 land cost). It is the API layer for the NWMLS partnership, not a substitute for it.

**Risks.** Paydirt's model (store facts, share across customers, sell credits) conflicts with "no storage" and "registered clients only". Works only if the partner broker's license, a VOW arrangement or a Paydirt vendor license allows Paydirt's customers to be "clients". One MLS per plan.

## 4. Apify (scraping platform)

**What it does.** Runs scrapers ("Actors") and stores results; most store Actors are written by third parties and priced per result ([store](https://apify.com/store), [pricing](https://apify.com/pricing)).
- Real estate Actors found: Zillow (several), Realtor.com, Crexi, Apartments.com — all third-party. None for LandWatch, LoopNet, Redfin or land specifically ([store](https://apify.com/store)). Example price: Realtor scraper ~$1 per 1,000 results ([actor](https://apify.com/epctex/realtor-scraper)); others not shown.

**API.** REST, Bearer token; 250,000 requests/minute global, 60/s per resource; datasets export to JSON, CSV, XLSX and more ([API](https://docs.apify.com/api/v2.md), [datasets](https://docs.apify.com/storage/dataset.md)).

**Pricing** ([pricing](https://apify.com/pricing)). Free ($5 usage/month), Starter $19, Scale $199, Business $999 per month; compute $0.13–0.20 per GB-hour; residential proxy $7–8/GB.

**Terms.** User is "solely responsible for the legality … and use of all Customer Data" and indemnifies Apify for scraping unauthorized sources ([general terms §5.8, §11.1](https://docs.apify.com/legal/general-terms-and-conditions)). Community Actors aren't reviewed for legal compliance ([Actor terms §9](https://docs.apify.com/legal/actor-terms-and-conditions.md)).

**Fit for Paydirt.**
- Listings (Q1/Q4): scraping Zillow, Crexi or LoopNet would breach those sites' terms, and reselling the result in credits multiplies the exposure. Not recommended.
- Will-they-let-you (Q3): a reasonable tool for **public government pages** — council and planning agendas and minutes, SEPA notices, permit portals without APIs — which the fit statement calls the most valuable and hardest data. Build Paydirt's own Actors or crawlers for these.
- Overlaps the "Research this parcel" web-search feature for one-off lookups.

**Risks.** Legal risk sits entirely with Paydirt; third-party scrapers break when sites change; quality is unreviewed.

## 5. GA4 (product analytics for Paydirt itself)

**What it does.** Free event analytics ([product](https://marketingplatform.google.com/about/analytics/), [terms §2](https://marketingplatform.google.com/about/analytics/terms/us/)). Not a land-data source.
- Limits (standard): 25 parameters per event, 25 user properties, 50 custom dimensions, 30 key events, data kept 2 or 14 months ([limits](https://support.google.com/analytics/answer/9267744), [360 comparison](https://support.google.com/analytics/answer/11202874)).
- Server-side events via Measurement Protocol, which must augment a browser tag, not replace it ([MP](https://developers.google.com/analytics/devguides/collection/protocol/ga4)).
- BigQuery export: daily export up to 1M events/day free (sandbox); streaming export billed at $0.05/GB ([BigQuery export](https://support.google.com/analytics/answer/9358801)).
- No personal information, hashed or not (§7), privacy policy and disclosure required ([terms](https://marketingplatform.google.com/about/analytics/terms/us/)). Consent mode exists; Google provides no banner ([consent mode](https://support.google.com/analytics/answer/9976101)).

**Fit for Paydirt.** Measures the funnel (county unlocks, deep checks bought, fit statements opened) and which "not checked yet" filters users hit — useful input to the "unknown counts form the data roadmap" idea. Rules for Paydirt: send an opaque user ID only, never emails, parcel owner names or addresses users type.

**Risks.** Weak for B2B per-account analysis and short retention (14 months) unless exported. Paydirt's own `api_calls` ledger already records paid usage; GA4 would add the front-end funnel. A product-analytics tool (PostHog, Amplitude, etc.) may fit better — not researched here.

## 6. Urbanum

**What it does.** Office and industrial listings and market statistics across 99 US markets, updated daily, with API, flat files and an MCP connector ([home](https://www.urbanum.app/), [MCP](https://www.urbanum.app/mcp)). 300K+ properties, 200K+ listings ([company](https://www.urbanum.app/company)). Its "premium" page calls it "The CRE Data Terminal" ([premium](https://www.urbanum.app/premium)) — possibly what "CRE Terminal" in the request meant.

**Coverage.** Seattle office is in the national report ([national report](https://www.urbanum.app/market-report/national)); Seattle industrial unverified; King County boundary unverified; Clallam not covered. **No land, zoning, permits or owner-of-record data** stated anywhere.

**Pricing** ([pricing](https://www.urbanum.app/pricing)). Free $0; Individual $149/mo; Team and Enterprise "contact us". API is an add-on on Team and included on Enterprise; CSV export Enterprise only. API auth and rate limits unverified.

**Terms** ([terms](https://www.urbanum.app/terms-of-use)). Content for "personal, non-commercial use"; no distributing or reproducing content, including "data compilations"; no automated access. No separate API license published.

**Fit for Paydirt.** Only Q4 "market vacancy" for office/industrial in metro markets. Paydirt's users mostly buy land for other uses.

**Verdict.** Skip.

## 7. CRE Terminal (creterminal.com)

**What it does.** AI valuation and underwriting for a firm's own deals: ingests rent rolls, T12s and offering memoranda, builds pro formas, risk reports and comps ([home](https://creterminal.com/), [risk](https://creterminal.com/platform/risk), [market research](https://creterminal.com/platform/market-research)). Has a single-family development underwriting module (lots and home sales) ([SFD](https://creterminal.com/solutions/single-family-development)). MCP server and a REST API "on request" ([chat & MCP](https://creterminal.com/platform/chat-mcp)).

**Coverage.** Claims every major US MSA; Pacific Northwest listed with 38 markets ([geographies](https://creterminal.com/research/geographies)). No parcels, zoning or listings stated.

**Pricing and terms.** Request access only; no pricing, no terms of service published; the privacy policy excludes the application ([privacy](https://creterminal.com/privacy)).

**Fit for Paydirt.** It sits after Paydirt (underwriting the deal), which the fit statement puts out of scope. Not a data source Paydirt could license.

**Verdict.** Skip. If the request meant Urbanum's "CRE Data Terminal", see §6.

## 8. "Land takeoffs"

Most likely meaning: tools that measure a site — earthwork cut/fill, usable acres, yield — from plans, imagery or terrain. Two kinds:

- **Contractor takeoff tools** measure plans or aerial imagery to price a job.
  - STACK: $299–349 per user/month, 12-month terms; aerial takeoffs $10 per address; an API on request ([pricing](https://www.stackct.com/takeoff-and-estimate-pricing/), [aerial](https://www.stackct.com/aerial-image-takeoff/), [developers](https://www.stackct.com/developers/)). No earthwork feature found on the pages read.
  - Attentive.ai (Beam AI): AI takeoffs for landscaping and paving from imagery or plans; no price or API stated ([home](https://www.attentive.ai/)).
  - InSite (earthwork) and Trimble Business Center: pages failed to load — **unverified**.
- **Site test-fit tools** compute yield and grading from a parcel. TestFit: zoning pass/fail, massing, yield, flood, wetlands, soils, utilities, and "3D terrain with cut and fill" in Site Intelligence ([site intelligence](https://www.testfit.io/product/site-intelligence)). Urban Planner $75/user/mo, Site Solver from $15,000/yr, Site Intelligence +$150/mo, MCP connection +$100/mo; no public REST API found ([pricing](https://www.testfit.io/pricing), [MCP](https://www.testfit.io/mcp)).

**Fit for Paydirt.** Usable acres and earthwork are listed under "true site cost", which the fit statement marks out of scope. Mireye Enrich already covers slope; a rough usable-acres estimate can be derived from slope, wetlands and flood layers Paydirt already buys. None of these tools resell data to another SaaS.

**Verdict.** Skip for now. Revisit TestFit if housing customers ask for yield on finalists.

---

## Recommendation

**Try first**
1. **Regrid** — the cheapest route to a national parcel backbone with a zoning code on nearly every parcel, and the only vendor with *published* King and Clallam coverage. Next step: ask Regrid sales (a) the county-file and bulk prices for WA, (b) in writing, whether a SaaS may show parcel attributes to paying customers per county and keep cached data, and (c) Premium vs Standard plan price. Use the 30-day sandbox to compare its King zoning against Paydirt's hand-read tables.
2. **West Kite** — best match for the hard Q1 items (owner behind the LLC, permits, zoning districts) at shortlist scale, priced like Paydirt's own credits. Next step: a free key (the user signs up, not an agent) to call `GET /v1/coverage?state=WA`, then email the team for an API data license covering storage and display to customers. Don't build on it until that license exists.

**Conditional**
3. **Repliers** — only once the NWMLS broker partnership defines who the licensee is and whether Paydirt customers count as "clients". It's the integration layer for that deal, not a way around it.
4. **Apify** — only for public government sources (agendas, minutes, SEPA, permit portals) feeding Q3; never for listing sites.
5. **GA4** — fine to add for the funnel, with an opaque user ID and no personal data; low priority next to data accuracy.

**Skip**
- Urbanum (office/industrial only, non-commercial terms), CRE Terminal (deal underwriting, no data license), land takeoff tools (out of scope; no resale API).

**Open questions for you**
1. Was "CRE Terminal" meant to be Urbanum ("The CRE Data Terminal"), creterminal.com, or something else?
2. Was "Land take offs" meant as earthwork/cut-fill, usable-acre yield (TestFit-style), or a specific product name?
3. Regrid and West Kite both need a sales conversation about SaaS display rights — do you want to make those contacts, and is it acceptable to describe Paydirt's credits model to them?
4. For listings: will the NWMLS partner be the licensee (broker of record) with Paydirt as vendor? That decides whether Repliers is usable.
5. Would you consider a dedicated product-analytics tool instead of GA4? (Not researched.)
