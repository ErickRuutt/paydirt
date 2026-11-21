-- Paydirt schema. Applied by `npm run db:migrate` over the direct (unpooled) connection.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS api_calls (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status INTEGER,
  charged_usd DOUBLE PRECISION DEFAULT 0,
  result_count INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parcels (
  parcelnumb TEXT PRIMARY KEY,
  county TEXT,
  jurisdiction TEXT,
  address TEXT,
  acres DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  owner TEXT,
  mail_address TEXT,
  zoning TEXT,
  zoning_type TEXT,
  zoning_description TEXT,
  zoning_code_link TEXT,
  use_desc TEXT,
  land_value DOUBLE PRECISION,
  parcel_value DOUBLE PRECISION,
  sale_price DOUBLE PRECISION,
  sale_date TEXT,
  last_transfer_date TEXT,
  slope_p50 DOUBLE PRECISION,
  slope_p90 DOUBLE PRECISION,
  slope_frac_over_5 DOUBLE PRECISION,
  slope_valid_frac DOUBLE PRECISION,
  elev_high DOUBLE PRECISION,
  elev_low DOUBLE PRECISION,
  flood_fraction DOUBLE PRECISION,
  wetland_fraction DOUBLE PRECISION,
  developable_acres DOUBLE PRECISION,
  boundary_geojson TEXT,
  raw_json TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT DEFAULT '',
  first_seen TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrichments (
  id SERIAL PRIMARY KEY,
  parcelnumb TEXT NOT NULL,
  presets TEXT NOT NULL,
  match_status TEXT,
  raw_json TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enrichments_parcel ON enrichments (parcelnumb);

CREATE TABLE IF NOT EXISTS dataset_meta (
  name TEXT PRIMARY KEY,
  imported_at TEXT,
  rows INTEGER,
  source TEXT
);

CREATE TABLE IF NOT EXISTS block_groups (
  geoid TEXT PRIMARY KEY,
  acs_year INTEGER,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  population INTEGER,
  households INTEGER,
  hh_200k_plus INTEGER,
  median_income INTEGER,
  hh_with_kids INTEGER,
  geometry_json TEXT
);

CREATE TABLE IF NOT EXISTS zoning_rules (
  jurisdiction TEXT NOT NULL,
  zone TEXT NOT NULL,
  use TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('permitted','conditional','prohibited','unknown')),
  source_url TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (jurisdiction, zone, use)
);

CREATE TABLE IF NOT EXISTS isochrones (
  key TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  geojson TEXT NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- King County sales history, trimmed to parcels of 5+ acres (the land Paydirt searches).
CREATE TABLE IF NOT EXISTS sales (
  pin TEXT NOT NULL,
  doc_date TEXT,
  price DOUBLE PRECISION,
  instrument INTEGER,
  reason INTEGER,
  warning TEXT,
  seller TEXT,
  buyer TEXT,
  excise_nbr TEXT,
  recording_nbr TEXT
);
CREATE INDEX IF NOT EXISTS sales_pin_date ON sales (pin, doc_date);
