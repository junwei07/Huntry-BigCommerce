// Run unconditionally on every openDatabase call — safe only because a local
// SQLite file has no concurrent, independently-deployed writers to race
// against. Not shared with Postgres, which manages schema via node-pg-migrate
// instead (see db/migrations/).
//
// Deliberately missing: `store_hash`/`forced_by_user_id` REFERENCES clauses
// to `stores`/`users`. Those tables live in a separate SQLite file
// (credentials.sqlite), and plain node:sqlite has no cross-file foreign-key
// enforcement without ATTACH DATABASE — which would reintroduce the
// file-coupling this split is meant to avoid. This matches existing
// precedent: credentials-store's own SQLite driver doesn't enable
// `PRAGMA foreign_keys` either, so FK enforcement here is already
// app-layer-trusted in dev mode. Postgres keeps full FK enforcement
// (db/migrations/0001_huntry_schema.sql). FKs *within* this file (e.g.
// huntry_eggs -> huntry_rewards/huntry_events) are kept, since both sides
// live in the same database.
export const CREATE_HUNTRY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS huntry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TEXT,
    ends_at TEXT,
    header_banner_url TEXT,
    marker_radius_meters INTEGER NOT NULL DEFAULT 25,
    max_grab_count INTEGER NOT NULL DEFAULT 0,
    egg_claim_capacity INTEGER NOT NULL DEFAULT 1,
    theme TEXT NOT NULL DEFAULT '{}',
    is_featured INTEGER NOT NULL DEFAULT 0,
    featured_order INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (store_hash, slug)
  );
  CREATE INDEX IF NOT EXISTS huntry_events_store_hash_idx ON huntry_events (store_hash);

  CREATE TABLE IF NOT EXISTS huntry_sponsors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    logo_url TEXT,
    instagram_url TEXT,
    facebook_url TEXT,
    website_url TEXT,
    location TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS huntry_sponsors_store_hash_idx ON huntry_sponsors (store_hash);

  CREATE TABLE IF NOT EXISTS huntry_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sponsor_id INTEGER REFERENCES huntry_sponsors (id) ON DELETE SET NULL,
    egg_capacity INTEGER NOT NULL DEFAULT 1,
    reward_starts_at TEXT,
    reward_expires_at TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed_cart')),
    discount_value NUMERIC NOT NULL,
    discount_scope TEXT NOT NULL DEFAULT 'all' CHECK (discount_scope IN ('all', 'specific')),
    coupon_code TEXT,
    bc_promotion_id TEXT,
    bc_coupon_code_id TEXT,
    bc_customer_group_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS huntry_rewards_store_hash_idx ON huntry_rewards (store_hash);

  -- Only populated when discount_scope = 'specific'.
  CREATE TABLE IF NOT EXISTS huntry_reward_products (
    reward_id INTEGER NOT NULL REFERENCES huntry_rewards (id) ON DELETE CASCADE,
    bc_product_id INTEGER NOT NULL,
    PRIMARY KEY (reward_id, bc_product_id)
  );

  -- Egg placements. id is an app-generated UUID (crypto.randomUUID()),
  -- stored as TEXT since SQLite has no native UUID type — stable/portable
  -- across both drivers, claims key off this id.
  CREATE TABLE IF NOT EXISTS huntry_eggs (
    id TEXT PRIMARY KEY,
    store_hash TEXT NOT NULL,
    reward_id INTEGER NOT NULL REFERENCES huntry_rewards (id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES huntry_events (id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS huntry_eggs_event_id_idx ON huntry_eggs (event_id);
  CREATE INDEX IF NOT EXISTS huntry_eggs_reward_id_idx ON huntry_eggs (reward_id);

  -- Claims are deliberately NOT foreign-keyed to eggs/rewards/events — this
  -- mirrors the plugin's denormalized-snapshot rule: a claim's displayed
  -- reward/coupon must never change if the Reward is edited or deleted
  -- afterward.
  CREATE TABLE IF NOT EXISTS huntry_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_hash TEXT NOT NULL,
    egg_id TEXT NOT NULL,
    reward_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    reward_name_snapshot TEXT NOT NULL,
    bc_customer_id INTEGER NOT NULL,
    coupon_code TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    claim_lat REAL,
    claim_lng REAL,
    is_forced INTEGER NOT NULL DEFAULT 0,
    forced_by_user_id INTEGER,
    order_id INTEGER,
    redemption_status TEXT NOT NULL DEFAULT 'unredeemed'
      CHECK (redemption_status IN ('unredeemed', 'redeemed', 'flagged_unauthorized_use')),
    UNIQUE (egg_id, bc_customer_id)
  );
  CREATE INDEX IF NOT EXISTS huntry_claims_event_id_idx ON huntry_claims (event_id);
  CREATE INDEX IF NOT EXISTS huntry_claims_bc_customer_id_idx ON huntry_claims (bc_customer_id);
  CREATE INDEX IF NOT EXISTS huntry_claims_coupon_code_idx ON huntry_claims (coupon_code);
`;
