-- BC-HUN-038: the storefront header banner's description text and the
-- product-page CTA's title/description (the plugin's huntry_banner_description,
-- huntry_product_cta_title and huntry_product_cta_description options, kept per
-- store). One row per store, written by the admin's Featured tab. An empty
-- string means "use the default copy". The banner images are not here: image
-- storage does not exist yet (BC-HUN-044).
CREATE TABLE huntry_storefront_settings (
  store_hash TEXT PRIMARY KEY REFERENCES stores (store_hash) ON DELETE CASCADE,
  banner_description TEXT NOT NULL DEFAULT '',
  product_cta_title TEXT NOT NULL DEFAULT '',
  product_cta_description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
