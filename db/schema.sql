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

-- Added Nov 21, 2026: what's operating on a parcel and who owns it (shared facts every project can filter on).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tags TEXT;          -- JSON array, see TAG_LABELS in src/spec.js
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS businesses TEXT;    -- JSON [{label, kind, status, note}] from OpenStreetMap
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS owner_type TEXT;    -- individual / trust / llc / company / government
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS mail_attn TEXT;     -- attention line on the tax bill

-- Added Nov 21, 2026: platform identity (docs/projects-spec.md). Two layers of property IDs:
--   properties.property_uid  — the parcel itself, assigned once when it enters the master data; never changes.
--   project_properties.pp_uid — that property inside one organization's project (saved flag, status, notes).
-- Counts across organizations may only ever be reported as totals, never as who saved what.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS orgs (
  org_uid TEXT PRIMARY KEY,                 -- org_…
  name TEXT NOT NULL,
  clerk_org_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS users (
  user_uid TEXT PRIMARY KEY,                -- usr_…
  clerk_user_id TEXT UNIQUE NOT NULL,
  org_uid TEXT REFERENCES orgs(org_uid),
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS properties (
  property_uid TEXT PRIMARY KEY,            -- prop_…
  source TEXT NOT NULL,                     -- e.g. kc_assessor
  source_id TEXT NOT NULL,                  -- e.g. King County parcel number
  county_fips TEXT,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_id)
);
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS property_uid TEXT;
CREATE INDEX IF NOT EXISTS candidates_property_uid ON candidates (property_uid);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_uid TEXT UNIQUE;    -- prj_…
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_uid TEXT REFERENCES orgs(org_uid);
CREATE TABLE IF NOT EXISTS project_properties (
  pp_uid TEXT PRIMARY KEY,                  -- pp_…
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  property_uid TEXT NOT NULL REFERENCES properties(property_uid),
  org_uid TEXT REFERENCES orgs(org_uid),
  saved BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'new',       -- new / shortlist / contacted / rejected
  notes TEXT DEFAULT '',
  added_by TEXT REFERENCES users(user_uid),
  saved_at TIMESTAMPTZ,
  updated_by TEXT REFERENCES users(user_uid),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, property_uid)
);
CREATE INDEX IF NOT EXISTS project_properties_org_saved ON project_properties (org_uid) WHERE saved;
CREATE TABLE IF NOT EXISTS events (
  event_uid TEXT PRIMARY KEY,               -- evt_…
  type TEXT NOT NULL,                       -- property.saved / property.unsaved / property.status_changed / property.viewed
  property_uid TEXT,
  pp_uid TEXT,
  project_id INTEGER,
  org_uid TEXT,
  user_uid TEXT,
  data TEXT,                                -- JSON details
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_property ON events (property_uid, type);

-- Added Nov 21, 2026: in-app feedback. Kept here first so nothing is lost; also sent to Notion
-- (NOTION_TOKEN + NOTION_FEEDBACK_DB) for review. notion_error holds why a send failed.
CREATE TABLE IF NOT EXISTS feedback (
  feedback_uid TEXT PRIMARY KEY,
  user_uid TEXT REFERENCES users(user_uid),
  org_uid TEXT,
  name TEXT,
  email TEXT,
  kind TEXT NOT NULL DEFAULT 'idea',
  message TEXT NOT NULL,
  page TEXT,
  notion_page_id TEXT,
  notion_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at DESC);

-- Added Nov 21, 2026: one row per project version, so two saves can never write the same version.
CREATE UNIQUE INDEX IF NOT EXISTS project_spec_history_version ON project_spec_history (project_id, version);

-- Added Nov 22, 2026: requests to unlock more areas (a county, a city, or a city's zoning). Also copied to
-- the Notion feedback table; status here is what the app shows the person who asked.
CREATE TABLE IF NOT EXISTS area_requests (
  request_uid TEXT PRIMARY KEY,             -- area_…
  org_uid TEXT,
  user_uid TEXT REFERENCES users(user_uid),
  requested_by_name TEXT,
  kind TEXT NOT NULL DEFAULT 'city',        -- county / city / zoning
  area TEXT NOT NULL,
  use_text TEXT,
  notes TEXT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'requested', -- requested / in_progress / unlocked / declined
  feedback_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS area_requests_org ON area_requests (org_uid, created_at DESC);

-- Added Nov 23, 2026: more than one county. Existing rows are King County.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS county_fips TEXT;
UPDATE candidates SET county_fips = '53033' WHERE county_fips IS NULL;
CREATE INDEX IF NOT EXISTS candidates_county ON candidates (county_fips);

-- Added Nov 23, 2026: credits. One row per change to an organization's balance (balance = sum of delta).
-- Grants are added by hand while testing (npm run credits:grant); card purchases come later.
CREATE TABLE IF NOT EXISTS credit_ledger (
  entry_uid TEXT PRIMARY KEY,               -- crd_…
  org_uid TEXT NOT NULL,
  delta INTEGER NOT NULL,                   -- + grant or refund, − spend
  reason TEXT NOT NULL,                     -- grant / county_unlock / refund
  ref TEXT,                                 -- e.g. the unlock_uid
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_org ON credit_ledger (org_uid, created_at DESC);

-- Added Nov 23, 2026: a county's parcels bought by an organization (the quote they accepted, and how loading went).
CREATE TABLE IF NOT EXISTS county_unlocks (
  unlock_uid TEXT PRIMARY KEY,              -- unl_…
  org_uid TEXT NOT NULL,
  county_fips TEXT NOT NULL,
  county_name TEXT NOT NULL,
  place TEXT,                               -- what the person typed, e.g. Sequim
  min_acres DOUBLE PRECISION NOT NULL,
  parcels INTEGER NOT NULL,                 -- count at quote time
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'loading',   -- loading / done / failed
  loaded INTEGER,
  error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS county_unlocks_org ON county_unlocks (org_uid, created_at DESC);

-- Added Nov 23, 2026: where a parcel's address came from (county address points fill gaps in the parcel layer),
-- and the closest road for parcels with no address at all (shown as "Near …", never as the address).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_source TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS address_near TEXT;

-- Added Nov 23, 2026: web research on a parcel (findings with the pages they came from). Shared across
-- organizations like every other parcel fact; the organization that ran it paid the credit.
CREATE TABLE IF NOT EXISTS parcel_research (
  research_uid TEXT PRIMARY KEY,            -- rsc_…
  pin TEXT NOT NULL,
  property_uid TEXT,
  org_uid TEXT,
  findings TEXT NOT NULL,                   -- JSON [{category, text, sources: [{url, title}]}]
  searches INTEGER,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parcel_research_pin ON parcel_research (pin, created_at DESC);

-- Added Nov 23, 2026: unlocks started from inside a project remember it (requests already do).
ALTER TABLE county_unlocks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
