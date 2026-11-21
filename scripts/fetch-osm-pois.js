// Download named businesses in King County from OpenStreetMap (Overpass API) to data/raw/osm-pois.json.
// Shops, restaurants, fuel, banks, pharmacies, and named commercial/industrial buildings, with brand tags.
// Used by import-candidates to tag parcels with who operates there. Free, public data (ODbL).
// Usage: npm run fetch:osm
import { writeFileSync } from 'node:fs';

const BBOX = '47.08,-122.54,47.78,-121.06'; // south, west, north, east: King County
const query = `[out:json][timeout:240];
(
  nwr["shop"]["name"](${BBOX});
  nwr["brand"](${BBOX});
  nwr["amenity"~"^(fuel|fast_food|restaurant|pharmacy|bank|cinema|marketplace|car_wash|cafe|bar|pub|fitness_centre|childcare)$"]["name"](${BBOX});
  nwr["leisure"~"^(fitness_centre|sports_centre|bowling_alley|ice_rink)$"]["name"](${BBOX});
  nwr["building"~"^(retail|commercial|warehouse|industrial|supermarket|office)$"]["name"](${BBOX});
  nwr["office"]["name"](${BBOX});
);
out center tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'paydirt-land-search/0.1' },
  body: new URLSearchParams({ data: query }),
  signal: AbortSignal.timeout(300_000),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
const j = await res.json();
const pois = j.elements.map((e) => ({
  lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon,
  name: e.tags?.name ?? null, brand: e.tags?.brand ?? null,
  kind: e.tags?.shop ? `shop:${e.tags.shop}` : e.tags?.amenity ? `amenity:${e.tags.amenity}` : e.tags?.leisure ? `leisure:${e.tags.leisure}` : e.tags?.office ? `office:${e.tags.office}` : e.tags?.building ? `building:${e.tags.building}` : 'other',
  disused: Boolean(e.tags?.['disused:shop'] || e.tags?.disused || e.tags?.['abandoned'] || /\b(closed|vacant)\b/i.test(e.tags?.name ?? '')),
})).filter((p) => p.lat != null && (p.name || p.brand));
const file = new URL('../data/raw/osm-pois.json', import.meta.url).pathname;
writeFileSync(file, JSON.stringify({ fetched_at: new Date().toISOString(), source: 'OpenStreetMap via Overpass API (ODbL)', pois }));
console.log(`Saved ${pois.length.toLocaleString()} named businesses to ${file}`);
