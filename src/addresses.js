import { all, one, run } from './db.js';

// Street addresses for parcels that have none, from each county's own address points (one point per
// building entrance, keyed by parcel number). Bare land often has no address at all: those parcels get a
// "near" label from the closest road instead (nearRoad), shown as "Near …", never as an address.

const SOURCES = {
  53033: { layer: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Address/KingCo_AddressPoints/MapServer/0', pinField: 'PIN',
    fields: 'PIN,ADDR_FULL,PRIM_ADDR', street: (a) => a.ADDR_FULL?.trim(), primary: (a) => String(a.PRIM_ADDR ?? '') === '1', label: 'King County address points' },
  53009: { layer: 'https://websrv31.clallamcountywa.gov/server/rest/services/Site_Addresses/MapServer/0', pinField: 'geo_ID',
    fields: 'geo_ID,csm_addres,applic_sta,addr_locat', street: (a) => a.csm_addres?.split(',')[0]?.trim(), primary: (a) => a.addr_locat === 'Structure', label: 'Clallam County site addresses' },
};

async function query(layer, params) {
  const res = await fetch(`${layer}/query`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ f: 'json', returnGeometry: 'false', ...params }), signal: AbortSignal.timeout(60_000) });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.features ?? [];
}

// Fill missing addresses for a county (or the given pins). Returns how many parcels got one.
export async function fillAddresses(fips, pins = null) {
  const src = SOURCES[fips];
  if (!src) return 0;
  pins ??= (await all('SELECT pin FROM candidates WHERE county_fips = ? AND address IS NULL', [fips])).map((r) => r.pin);
  let filled = 0;
  for (let i = 0; i < pins.length; i += 150) {
    const batch = pins.slice(i, i + 150);
    const feats = await query(src.layer, { where: `${src.pinField} IN (${batch.map((p) => `'${p.replace(/'/g, '')}'`).join(',')})`, outFields: src.fields });
    const best = new Map();
    for (const { attributes: a } of feats) {
      const pin = String(a[src.pinField]).trim(), street = src.street(a);
      if (!street) continue;
      const cur = best.get(pin);
      if (!cur || (!cur.primary && src.primary(a))) best.set(pin, { street, primary: src.primary(a) });
    }
    for (const [pin, { street }] of best) {
      const r = await run('UPDATE candidates SET address = ?, address_source = ? WHERE pin = ? AND address IS NULL', [street, src.label, pin]);
      filled += r.rowCount;
    }
  }
  return filled;
}

// Closest named road to a parcel's center, from OpenStreetMap; cached on the parcel. Used only when there
// is no address. Returns e.g. "Old Olympic Hwy, Sequim" or null.
export async function nearRoad(pin) {
  const c = await one('SELECT lat, lng, address, address_near FROM candidates WHERE pin = ?', [pin]);
  if (!c || c.address || c.address_near || c.lat == null) return c?.address_near ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ lat: c.lat, lon: c.lng, zoom: '17', format: 'jsonv2', addressdetails: '1' })}`;
    const j = await (await fetch(url, { headers: { 'user-agent': 'Paydirt/1.0 (land research tool)' }, signal: AbortSignal.timeout(6000) })).json();
    const a = j.address ?? {};
    const road = a.road ?? a.track ?? null;
    if (!road) return null;
    const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? null;
    const near = town ? `${road}, ${town}` : road;
    await run('UPDATE candidates SET address_near = ? WHERE pin = ?', [near, pin]);
    return near;
  } catch { return null; }
}
