-- One row per store (only one Huntry page is ever provisioned per install).
-- page_id is BigCommerce's own id; created_by_app is false when an existing
-- merchant-owned /huntry/ page was adopted instead of created.
CREATE TABLE store_storefront_pages (
  store_hash TEXT PRIMARY KEY REFERENCES stores (store_hash) ON DELETE CASCADE,
  page_id INTEGER NOT NULL,
  created_by_app BOOLEAN NOT NULL
);
