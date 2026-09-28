CREATE TABLE huntry_events (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_hash TEXT NOT NULL REFERENCES stores (store_hash) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  header_banner_url TEXT,
  marker_radius_meters INTEGER NOT NULL DEFAULT 25,      -- claim proximity
  max_grab_count INTEGER NOT NULL DEFAULT 0,              -- 0 = unlimited; per-player cap across this event
  egg_claim_capacity INTEGER NOT NULL DEFAULT 1,          -- distinct players per egg, event-wide default
  theme JSONB NOT NULL DEFAULT '{}',                       -- marker/theme colors, custom icon URLs
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  featured_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_hash, slug)
);
CREATE INDEX huntry_events_store_hash_idx ON huntry_events (store_hash);
-- Status (not-scheduled/upcoming/live/ended) is DERIVED from starts_at/ends_at
-- at read time, exactly like the plugin's huntry_compute_event_status() —
-- never stored.

CREATE TABLE huntry_sponsors (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_hash TEXT NOT NULL REFERENCES stores (store_hash) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_url TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  website_url TEXT,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX huntry_sponsors_store_hash_idx ON huntry_sponsors (store_hash);

CREATE TABLE huntry_rewards (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_hash TEXT NOT NULL REFERENCES stores (store_hash) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sponsor_id INTEGER REFERENCES huntry_sponsors (id) ON DELETE SET NULL,
  egg_capacity INTEGER NOT NULL DEFAULT 1,                -- cap on total placements
  reward_starts_at TIMESTAMPTZ,
  reward_expires_at TIMESTAMPTZ,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed_cart')),
  discount_value NUMERIC(10, 2) NOT NULL,
  discount_scope TEXT NOT NULL DEFAULT 'all' CHECK (discount_scope IN ('all', 'specific')),
  coupon_code TEXT,                                        -- shared code, one per reward
  bc_promotion_id TEXT,                                     -- Promotions v3 promotion id, once synced
  bc_coupon_code_id TEXT,                                   -- Promotions v3 coupon-codes sub-resource id
  bc_customer_group_id TEXT,                                -- eligibility group backing the redemption guard
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX huntry_rewards_store_hash_idx ON huntry_rewards (store_hash);

-- Only populated when discount_scope = 'specific'.
CREATE TABLE huntry_reward_products (
  reward_id INTEGER NOT NULL REFERENCES huntry_rewards (id) ON DELETE CASCADE,
  bc_product_id INTEGER NOT NULL,
  PRIMARY KEY (reward_id, bc_product_id)
);

-- Egg placements. id is an app-generated UUID (crypto.randomUUID(), not a
-- Postgres extension) so it's stable/portable across both drivers — claims
-- key off this id the same way WP claims key off the egg's uuid.
CREATE TABLE huntry_eggs (
  id UUID PRIMARY KEY,
  store_hash TEXT NOT NULL REFERENCES stores (store_hash) ON DELETE CASCADE,
  reward_id INTEGER NOT NULL REFERENCES huntry_rewards (id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES huntry_events (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX huntry_eggs_event_id_idx ON huntry_eggs (event_id);
CREATE INDEX huntry_eggs_reward_id_idx ON huntry_eggs (reward_id);

-- Claims are deliberately NOT foreign-keyed to eggs/rewards/events — this
-- mirrors the plugin's denormalized-snapshot rule: a claim's displayed
-- reward/coupon must never change if the Reward is edited or deleted
-- afterward. Only bc_customer_id and forced_by_user_id (which DOES fk to
-- credentials-store's own `users`) are "live" references.
CREATE TABLE huntry_claims (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_hash TEXT NOT NULL REFERENCES stores (store_hash) ON DELETE CASCADE,
  egg_id UUID NOT NULL,
  reward_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  reward_name_snapshot TEXT NOT NULL,
  bc_customer_id INTEGER NOT NULL,
  coupon_code TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_lat DOUBLE PRECISION,
  claim_lng DOUBLE PRECISION,
  is_forced BOOLEAN NOT NULL DEFAULT FALSE,
  forced_by_user_id INTEGER REFERENCES users (user_id),
  order_id INTEGER,                                         -- written only by the order webhook
  redemption_status TEXT NOT NULL DEFAULT 'unredeemed'
    CHECK (redemption_status IN ('unredeemed', 'redeemed', 'flagged_unauthorized_use')),
  UNIQUE (egg_id, bc_customer_id)   -- one player can't claim the same egg twice
);
CREATE INDEX huntry_claims_event_id_idx ON huntry_claims (event_id);
CREATE INDEX huntry_claims_bc_customer_id_idx ON huntry_claims (bc_customer_id);
CREATE INDEX huntry_claims_coupon_code_idx ON huntry_claims (coupon_code);
