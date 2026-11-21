# Paydirt

Small local app for testing a land screen on one county (King, WA) with the Mireye parcel API. See `ARCHITECTURE.md` for the design.

## Run

1. Connect Mireye once with `mireye-mcp connect` (the app reads the saved key from `~/.config/mireye-mcp/credentials.json`). To use a different key, set `MIREYE_API_KEY` in `.env`.
2. `cp .env.example .env`. `MAX_SPEND_USD` caps total spend (default $2).
3. `npm install`, then `npm run dev`, then open http://localhost:4310.

Needs Node 22.13+ (uses the built-in `node:sqlite`). Data lives in `data/paydirt.db`.

## Using it

- **Search** ($0.20 per page, up to 100 parcels): acreage range plus developable acres and wetland filters. Start with 10.
- **Screen** (free): each parcel is checked against `criteria.json` for slope, flood, wetland and developable acres. Missing data shows as "review", never a pass.
- **Zoning**: open the zoning code link, then record whether each use is permitted, conditional or prohibited in that zone. The verdict applies to every parcel in that jurisdiction and zone.
- **Enrich** ($0.02): full Mireye profile (zoning, terrain, constraints) for one parcel.
- **Review**: status (new / shortlist / rejected / contacted) and notes per parcel.
- Map layers: satellite, hillshade, 3D terrain.

Jurisdiction comes from the parcel's situs city, so unincorporated parcels group as "UNINCORPORATED / UNKNOWN". Check those against King County Title 21A.

## Reference data (free, run once; rerun to refresh)

```bash
# Ownership history: King County Assessor sales (~150 MB zip, ~2.4M records)
curl -o data/raw/sales.zip "https://aqua.kingcounty.gov/extranet/assessor/Real%20Property%20Sales.zip"
unzip -o data/raw/sales.zip -d data/raw && node scripts/import-sales.js

# Demographics: block-group shapes (no key) + ACS 5-year income/kids (needs CENSUS_API_KEY in .env)
node --env-file-if-exists=.env scripts/import-census.js
```

- **Ownership:** each parcel shows its last transfer, last market sale, years held and seller signals (inherited, long hold, family/trust transfer). Assessor codes split market sales from quitclaims and estate transfers.
- **Who's nearby:** households, $200k+ households, households with kids and approximate income within 5/10/15 miles (straight line, set in `criteria.json`). Census income brackets top out at $200k+, so that's the affluence measure.
- **Drive time:** with `MAPBOX_TOKEN` (or `MAPBOX_API`) in `.env`, opening a parcel draws 20 and 30 minute drive areas (Mapbox Isochrone, typical traffic; `driveMinutes` in `criteria.json`) and counts the same Census numbers inside them. Results are cached in the `isochrones` table for 90 days; the token never reaches the browser.
- **Map:** the "$200k+ households" layer shades block groups by share of $200k+ households.

## Candidates (free county data)

The Candidates tab lists every King County parcel of 5+ acres, ranked for a **project** (`docs/projects-spec.md`).
A project has a name, a brief and a versioned **criteria spec** (`src/spec.js`):
- **Requirements** filter (acres, zoning verdict, city vs unincorporated, places, $200k+ households, land value per acre, vacant only, owner signals).
- **Preferences** each give a 0–100 sub-score; the project score is their weighted average.

The candidates table holds facts only; projects are scored in SQL at read time, so editing criteria re-ranks instantly
without re-fetching anything. Each spec change is saved as a new version with a note (`project_spec_history`).
Shortlists and notes belong to a project (`project_reviews`). Always hidden: tax-exempt parcels and public or institutional uses.

The Field House project reproduces the earlier scoring: zoning 18%, size 12%, vacancy 10%, owner signals 35%, $200k+ households 25%,
requiring zoning that allows (or hasn't ruled out) a sports facility and 5–80 acres.

Rebuild (after refreshing the raw files in `data/raw/`):
```
npm run fetch:gis            # King County GIS parcels 5+ acres -> data/raw/gis-parcels.json
npm run fetch:osm            # named businesses from OpenStreetMap -> data/raw/osm-pois.json
npm run import:candidates    # needs account/EXTR_RPAcct_NoName.csv and parcel/EXTR_Parcel.csv
```
Reviews (status, notes) are kept per project in `project_reviews` and survive rebuilds.

## Map overlays

- **City limits**: incorporated cities tinted blue; untinted land is unincorporated King County (county zoning applies).
- **Urban growth line**: King County's Urban Growth Area boundary; the rural side is tinted green.

Both are public King County GIS boundaries saved as static files in `public/data/`. Refresh with `npm run fetch:boundaries`.

## Site tags (what's on the land)

Each candidate carries shared facts every project can filter on: vacant land, operating business, major anchor tenant,
leased to a business, company-owned, closing or bankrupt tenant, possible empty building, tax bill paid by a business.
They come from the assessor's use code, building value per acre, owner type (from sales-record buyer names), the tax bill's
mailing address, and businesses mapped in OpenStreetMap inside the parcel. Anchor and closing-chain lists live in
`src/tenants.js` (reviewed Nov 2026; the closing list goes stale and should be fed by news later).

Projects decide what the tags mean: `tags_exclude` / `tags_include` requirements, and the `business_on_site` preference,
which ranks operating sites lower and caps their score (Field House v2: capped at 40; closing tenants and possible empty
buildings keep partial credit).

## Pages

- `/` (index.html): home. Your organization's projects and every property saved across them.
- `/project.html?id=N`: one project's saved properties, with status and notes.
- `/map.html?project=N[&pin=PIN][&new=brief|interview|form]`: the map and research tool. ☆ saves a parcel to the project.

## Identity and IDs (groundwork for multi-company use)

- `properties.property_uid` (`prop_…`): the parcel itself, assigned once when it enters the master data
  (keyed by source + source id, e.g. `kc_assessor` + parcel number). Rebuilds keep it.
- `project_properties.pp_uid` (`pp_…`): that property inside one organization's project: saved flag, status, notes,
  who saved it and when. Replaces `project_reviews` (kept, empty, for now).
- `orgs.org_uid` (`org_…`), `users.user_uid` (`usr_…`, mapped from Clerk on first request), `projects.project_uid` (`prj_…`).
  Everything is scoped to the user's organization; everyone joins the "Paydirt" org for now.
- `events` (`evt_…`): append-only log of property.saved / unsaved / status_changed. Nothing reads it yet. Reports
  across organizations must only ever use totals, never who saved what.
