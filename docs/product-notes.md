# Paydirt product notes

Living notes on where Paydirt is going. Started Nov 21, 2026.

## How the data works today, and how to make it "on the fly"

Today one county (King) is prebuilt: a script pulls free county data (GIS parcels, assessor accounts,
sales history, Census) and scores every 5+ acre parcel into the `candidates` table (~21k rows, ~10 s
to rescore). Reading that table is instant because nothing is computed at request time.

"On the fly" for a new area means the same pipeline, triggered when someone asks for an area:

1. **Universe (free, minutes):** pull that county's parcel layer from its GIS service, clipped to the
   area. Every county publishes this differently, so each new county is a small adapter
   (field names, zoning codes, how sales and owners are published).
2. **Score (seconds):** the scoring code is county-agnostic once the adapter maps fields.
3. **Enrich (paid, per parcel, on demand):** slope, wetlands and flood (Mireye), drive time (Mapbox),
   only for parcels someone opens or shortlists. These are cached, so the second viewer pays nothing.

So "fast" = precompute the free layers per county and cache every paid call. The slow, unscalable
part is not compute but *reading rules*: zoning tables (one per city), assessor formats (one per
county) and old-vs-new zone names.

### Limitations to keep in mind
- **Zoning is the bottleneck.** ~13 city tables took a few hours to read by hand; some cities publish
  tables as images (Black Diamond) or behind bot walls. Scaling needs an LLM-assisted reader with a
  human check, plus a correction loop from users.
- **County data quality varies.** King County strips owner names from bulk files and its hazard
  flags are empty; other counties may be better or worse. Some counties charge for bulk data.
- **Assessor zone codes lag city rezones** (Auburn R5/C3, Tukwila, Covington MC), producing "unknown".
- **Straight-line market numbers** are a stand-in; drive time costs a Mapbox call per parcel.
- **Listings are walled** (LoopNet/Crexi/CoStar have no open feeds). Routes: user-forwarded alerts,
  broker/MLS partnership, paid data providers.
- **Database growth:** a county is tens of MB; nationally that's tens of GB plus geometry, so a move
  to PostGIS with vector tiles (instead of shipping GeoJSON) is needed before many counties.

## Monetization: consumption model (not during testing)

- **Buy an area once → it unlocks** (like AllTrails regions): the free-data layers and scores for
  that county or metro, map overlays, saved searches.
- **Tokens for refreshes and paid calls:** a refresh pulls net-new data (new sales, listings, permits,
  rezones) and costs fewer tokens than the first unlock. Paid enrichments (slope/wetland, drive time,
  owner lookups) each cost tokens priced above the API cost.
- Every paid call already goes through one spend guard (`api_calls` ledger + cap). Per-user and
  per-org caps, then token balances, slot into that same guard.
- Cache everything paid so the second buyer of an area costs us nothing — that's the margin.

## Overlays to add
- Development sites (active permits, SEPA notices, land-use applications).
- Incorporated vs unincorporated land (city limits), with urban growth area boundary.
- Zoning verdict, ownership signals, drive-time, $200k+ households (exists), flood/wetland.

## Intel network (the Blind/Fishbowl idea) — to think about
Users log intel and notes on properties (owner conversations, broker whispers, site-visit notes,
"for sale soon"). Open questions:
- **Reward:** tokens for intel others find useful (upvotes, or when a parcel they flagged sells),
  unlocks of features or areas, reputation/badges. Give-to-get: post intel to see others' intel.
- **Trust:** anonymous but verified (like Blind's verified-employer model): verified broker,
  developer, owner, resident. Reputation-weighted visibility.
- **Abuse:** false intel to move prices, doxxing owners. Needs moderation and rules about personal info.
- **Privacy:** notes about private owners are sensitive; keep personal data out of public posts.
