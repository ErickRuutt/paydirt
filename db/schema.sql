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

-- Every King County parcel of 5+ acres, scored for fit, owner likelihood to sell and market.
-- Rebuilt by `npm run import:candidates` from free county data; no paid API calls.
CREATE TABLE IF NOT EXISTS candidates (
  pin TEXT PRIMARY KEY,
  address TEXT,
  city TEXT,               -- NULL = unincorporated King County
  postal_city TEXT,
  zip TEXT,
  acres DOUBLE PRECISION,
  zoning TEXT,
  sports_verdict TEXT,     -- permitted / conditional / prohibited / unknown
  sports_note TEXT,
  present_use TEXT,
  prop_type TEXT,
  land_value DOUBLE PRECISION,
  impr_value DOUBLE PRECISION,
  tax_status TEXT,         -- T taxable, X exempt, O operating
  current_use TEXT,        -- open space / farm / timber tax program, if any
  mail_address TEXT,
  mail_city_state TEXT,
  absentee BOOLEAN,
  out_of_state BOOLEAN,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  geometry_json TEXT,
  years_held DOUBLE PRECISION,       -- since last market sale
  years_since_transfer DOUBLE PRECISION,
  signals TEXT,                      -- JSON array
  hh200k_10mi INTEGER,
  share200k_10mi DOUBLE PRECISION,
  kids_share_10mi DOUBLE PRECISION,
  fit_score INTEGER,
  owner_score INTEGER,
  market_score INTEGER,
  score INTEGER,
  excluded TEXT,                     -- reason it's hidden by default, or NULL
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Review state for candidates, kept apart so rebuilding candidates never wipes it.
CREATE TABLE IF NOT EXISTS candidate_reviews (
  pin TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Added Nov 21, 2026: where each zoning verdict came from (county or city code URL).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS zoning_source TEXT;

-- Added Nov 21, 2026: search profiles. Scores are computed from a profile at read time, so the
-- candidates table holds facts only.
CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,          -- JSON, see src/profiles.js DEFAULT_PROFILE
  created_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
DROP INDEX IF EXISTS candidates_score;
ALTER TABLE candidates DROP COLUMN IF EXISTS fit_score, DROP COLUMN IF EXISTS owner_score,
  DROP COLUMN IF EXISTS market_score, DROP COLUMN IF EXISTS score;

-- Added Nov 21, 2026: projects (docs/projects-spec.md). A project is one buyer's search: brief,
-- versioned criteria spec, and its own shortlist and notes. Replaces search profiles.
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  brief TEXT DEFAULT '',
  spec TEXT NOT NULL,              -- JSON criteria spec (src/spec.js)
  spec_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  archived BOOLEAN DEFAULT false
);
CREATE TABLE IF NOT EXISTS project_spec_history (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  spec TEXT NOT NULL,
  change_note TEXT DEFAULT '',
  source TEXT DEFAULT 'form',      -- form / markdown / interview / mcp / migration
  changed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_reviews (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, pin)
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',   -- owner / editor / viewer
  added_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Search profiles and global reviews were replaced by projects (Nov 21, 2026).
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS candidate_reviews;
