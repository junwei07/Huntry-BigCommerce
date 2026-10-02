-- BC-HUN-020: the coupon code is now admin-typed (matching the legacy WP
-- plugin's required "Gift Card Code" field) rather than system-generated,
-- so a second reward in the same store could otherwise collide on the same
-- code. Postgres and SQLite both treat NULL as distinct under UNIQUE, so
-- this needs no backfill for existing rows with coupon_code IS NULL.
ALTER TABLE huntry_rewards
  ADD CONSTRAINT huntry_rewards_store_hash_coupon_code_key UNIQUE (store_hash, coupon_code);
