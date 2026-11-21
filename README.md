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
