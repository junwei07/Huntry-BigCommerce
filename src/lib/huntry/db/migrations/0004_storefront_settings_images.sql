-- BC-HUN-044: the Featured tab's two banner images (button logo, banner image)
-- now persist an uploaded image URL. An empty string means "use the bundled
-- default image", the same convention as the copy columns above.
ALTER TABLE huntry_storefront_settings
  ADD COLUMN banner_logo_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN banner_image_url TEXT NOT NULL DEFAULT '';
