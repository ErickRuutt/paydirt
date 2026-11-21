# Paydirt: architecture

A small local app for testing the parcel search on a tiny sample in one county (King, FIPS `53033`) before spending real money or building anything bigger.

## Components

| Layer | Choice | Why |
|---|---|---|
| Map | MapLibre GL JS (CDN, no build step) | Free, open source, vector + raster, 3D terrain built in. No Mapbox token. |
| Basemap | OpenFreeMap "liberty" style | Free, no key. Esri World Imagery as a satellite toggle. |
| Elevation (display) | AWS Terrain Tiles (Terrarium encoding) | Free global DEM tiles; drives hillshade and 3D terrain. Good for looking, not for measuring. |
| Elevation (measured) | Mireye `parcel_slope_*` fields (USGS 3DEP, 30 m lattice) | Parcel-wide slope stats come back in the same search call. Later: 1 m 3DEP / WA DNR lidar for the shortlist only. |
| Parcel data | Mireye Search + Enrich, called only from the server | API key never reaches the browser. Every call is logged with its cost. |
| Storage | SQLite via Node's built-in `node:sqlite` | Zero setup. Move to Neon + PostGIS once there are thousands of parcels or more than one user. |
| Zoning | `zoning_rules` table: jurisdiction × zone × use → verdict | Mireye gives the zone code and a link to the code. A person (or later, Claude) reads the code and records whether lit fields, a sports club, a restaurant and offices are permitted, conditional or prohibited. |
| Criteria | `criteria.json` | One place to change acreage, slope, flood and wetland thresholds. Parcels are re-scored locally without new API calls. |

## Data flow

1. **Search** (server → Mireye `/v1/search`): `state2=WA`, `county=53033`, acreage range, plus any filterable criteria (wetland fraction, developable acres). Returns up to `limit` parcels with the fields we ask for. Cost: $0.20 per page, whatever the size.
2. **Store**: upsert each match into `parcels` keyed by `parcelnumb`; keep the raw JSON so we can re-parse without paying again.
3. **Score** (local, free): apply `criteria.json` to stored fields. Slope fields can't be search filters, so they're checked here.
4. **Zoning check** (local): look up `(jurisdiction, zoning)` in `zoning_rules`. Unknown zones show up as "needs review" with the code link.
5. **Enrich** (on demand, one parcel at a time): `/v1/enrich` with chosen presets. Cost: $0.02 per matched parcel.
6. **Review**: on the map, set a parcel's status (new / shortlist / rejected / contacted) and add notes.

## Practices built in

- **Cost guard.** Every call sends `max_cost_usd`, and the server refuses calls once `MAX_SPEND_USD` is reached (tracked in `api_calls`).
- **Idempotency keys** on every paid call, so a retry never double-charges.
- **Cache first.** Never re-buy a parcel already stored; re-scoring is free.
- **Coordinates.** GeoJSON in WGS84, `[lng, lat]` order everywhere. Mireye's `analysis_point` can fall outside the boundary, so use the boundary for display.
- **Map layers.** Basemap, terrain and data are separate sources. Parcels are one GeoJSON source with `promoteId: parcelnumb`, colored by score, with feature-state for hover and selection.
- **Attribution** shown for every tile source.
- **Screening, not survey.** Slope, wetland and "developable acres" are screening proxies. Nothing replaces a zoning confirmation and a site visit.

## Later

- 1 m slope for shortlisted parcels from USGS 3DEP / WA DNR lidar.
- Census ACS income and drive-time layers (affluence within 20–30 minutes).
- Claude reads the municipal code at `zoning_code_link` and drafts a verdict for a person to approve.
- Owner grouping for assemblages; outreach export.
- Move to Neon + PostGIS and deploy once the screen is proven.
