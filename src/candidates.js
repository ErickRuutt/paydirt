// Parcel facts helpers shared by every project. Scoring lives in src/spec.js and src/projects.js.

// The handful of enrich fields that answer "is it buildable" — shown first in the panel.
export const KEY_FIELDS = {
  owner: 'Owner',
  parcel_slope_pct_p50: 'Median slope %',
  parcel_slope_frac_over_5pct: 'Share over 5% grade',
  wetland_fraction_of_parcel: 'Wetland share',
  parcel_flood_sfha_fraction: 'Flood zone share',
  developable_acres_proxy: 'Developable acres (estimate)',
  zoning: 'Zoning',
  zoning_description: 'Zoning description',
};
