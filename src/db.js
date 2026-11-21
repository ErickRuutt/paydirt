import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
export const db = new DatabaseSync(new URL('../data/paydirt.db', import.meta.url).pathname);

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS api_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status INTEGER,
  charged_usd REAL DEFAULT 0,
  result_count INTEGER,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parcels (
  parcelnumb TEXT PRIMARY KEY,
  county TEXT,
  jurisdiction TEXT,
  address TEXT,
  acres REAL,
  lat REAL,
  lng REAL,
  owner TEXT,
  mail_address TEXT,
  zoning TEXT,
  zoning_type TEXT,
  zoning_description TEXT,
  zoning_code_link TEXT,
  use_desc TEXT,
  land_value REAL,
  parcel_value REAL,
  sale_price REAL,
  sale_date TEXT,
  last_transfer_date TEXT,
  slope_p50 REAL,
  slope_p90 REAL,
  slope_frac_over_5 REAL,
  slope_valid_frac REAL,
  elev_high REAL,
  elev_low REAL,
  flood_fraction REAL,
  wetland_fraction REAL,
  developable_acres REAL,
  boundary_geojson TEXT,
  raw_json TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT DEFAULT '',
  first_seen TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parcelnumb TEXT NOT NULL,
  presets TEXT NOT NULL,
  match_status TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dataset_meta (
  name TEXT PRIMARY KEY,
  imported_at TEXT,
  rows INTEGER,
  source TEXT
);

CREATE TABLE IF NOT EXISTS block_groups (
  geoid TEXT PRIMARY KEY,
  acs_year INTEGER,
  lat REAL,
  lng REAL,
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
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (jurisdiction, zone, use)
);
`);

export function totalSpend() {
  return db.prepare('SELECT COALESCE(SUM(charged_usd),0) AS s FROM api_calls').get().s;
}
