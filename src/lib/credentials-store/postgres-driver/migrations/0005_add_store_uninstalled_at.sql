-- Tombstone set at the start of an uninstall (markStoreUninstalled): the store
-- reads as unknown while its data is wiped, so no new rows can be written for
-- it. A reinstall (setStore) clears it.
ALTER TABLE stores ADD COLUMN uninstalled_at TIMESTAMPTZ;
