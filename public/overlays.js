/* global map, $ */
// Reference overlays: city limits (incorporated vs unincorporated) and the Urban Growth Area line.
// Static public boundaries from King County GIS (scripts/fetch-boundaries.js → public/data/).
(() => {
  const CITY = '#5C3D20', RURAL = '#4C9A6E'; // cacao for cities, moss for the rural side
  let loaded = false;

  async function ensure() {
    if (loaded) return;
    loaded = true;
    const before = ['cand-sel-fill', 'cand-pt', 'parcel-fill'].find((id) => map.getLayer(id));
    map.addSource('cities', { type: 'geojson', data: 'data/city-limits.geojson' });
    map.addSource('uga', { type: 'geojson', data: 'data/urban-growth-area.geojson' });
    map.addLayer({ id: 'city-fill', type: 'fill', source: 'cities', layout: { visibility: 'none' }, paint: { 'fill-color': CITY, 'fill-opacity': 0.22 } }, before);
    map.addLayer({ id: 'city-line', type: 'line', source: 'cities', layout: { visibility: 'none' }, paint: { 'line-color': CITY, 'line-width': 2, 'line-opacity': 0.9 } }, before);
    map.addLayer({
      id: 'city-label', type: 'symbol', source: 'cities', minzoom: 9,
      layout: { visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'symbol-placement': 'point', 'text-allow-overlap': false },
      paint: { 'text-color': '#3B2416', 'text-halo-color': '#F3EDE2', 'text-halo-width': 1.5 },
    });
    // Rural side of the growth boundary gets a light tint; the line itself is dashed.
    map.addLayer({ id: 'uga-rural', type: 'fill', source: 'uga', filter: ['==', ['get', 'side'], 'r'], layout: { visibility: 'none' }, paint: { 'fill-color': RURAL, 'fill-opacity': 0.12 } }, before);
    map.addLayer({ id: 'uga-line', type: 'line', source: 'uga', filter: ['==', ['get', 'side'], 'u'], layout: { visibility: 'none' }, paint: { 'line-color': '#A4452A', 'line-width': 2, 'line-dasharray': [3, 2] } }, before);
  }

  const show = (ids, on) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  const whenReady = (fn) => (map.isStyleLoaded() && map.getSource('cand') !== undefined ? fn() : map.once('idle', fn));

  $('lyCity').onchange = (e) => whenReady(async () => {
    await ensure();
    show(['city-fill', 'city-line', 'city-label'], e.target.checked);
    $('cityLegend').hidden = !e.target.checked;
  });
  $('lyUga').onchange = (e) => whenReady(async () => {
    await ensure();
    show(['uga-rural', 'uga-line'], e.target.checked);
    $('ugaLegend').hidden = !e.target.checked;
  });
})();
