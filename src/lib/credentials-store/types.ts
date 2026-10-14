export type CredentialsStoreDriver = "SQLITE" | "POSTGRES" | "D1" | "FIRESTORE";

// A store's OAuth grant. adminUserId is the id of the user who completed
// the install — every store has exactly one.
export interface StoreRecord {
  storeHash: string;
  accessToken: string;
  scope: string;
  adminUserId: number;
}

// A BigCommerce user, not scoped to a single store (linked to stores via
// StoreUserRecord). No username: it's not present on every payload that
// identifies a user, and nothing in this app reads it.
export interface UserRecord {
  userId: number;
  email: string;
}

// The join between a store and a user authorized to access it.
export interface StoreUserRecord {
  storeHash: string;
  userId: number;
}

// Links a store to the App Extension registered for it at install time.
// extensionId is BigCommerce's own opaque id, not something this app
// generates.
export interface StoreExtensionRecord {
  storeHash: string;
  extensionId: string;
}

// Links a store to the Huntry storefront script registered for it at
// install time. scriptId is BigCommerce's own opaque id (Scripts API), not
// something this app generates. One row per store (only one script is ever
// registered per install) — same 1:1 shape as StoreExtensionRecord.
export interface StoreStorefrontScriptRecord {
  storeHash: string;
  scriptId: string;
}

// Links a store to the Huntry content page provisioned for it (Pages API),
// so provisioning runs once per store and a page the merchant later deletes
// is not silently recreated on every app load. pageId is BigCommerce's own
// id. createdByApp is false when an existing, merchant-owned /huntry/ page
// was found instead of created: the app must never delete that one on
// uninstall. One row per store, like StoreStorefrontScriptRecord.
export interface StoreStorefrontPageRecord {
  storeHash: string;
  pageId: number;
  createdByApp: boolean;
}

// Links a store to one registered webhook (Webhooks API). hookId is
// BigCommerce's own opaque id. Keyed by (storeHash, scope) rather than
// storeHash alone, since more than one webhook scope may be registered over
// time (e.g. a future store/cart/updated alongside store/order/created).
export interface StoreWebhookRecord {
  storeHash: string;
  scope: string;
  hookId: string;
}

// Generic persistence for per-store API credentials, implemented by one
// driver per backing DB (see sqlite-driver/ and postgres-driver/) — see
// docs/ARCHITECTURE.md for the full design (upsert semantics, the
// deleteStore/deleteUser cascades, and isStoreUserLinked's role in
// isAuthorizedForStore).
export interface CredentialsStore {
  setStore(store: StoreRecord): Promise<void>;
  setUser(user: UserRecord): Promise<void>;
  setStoreUser(storeUser: StoreUserRecord): Promise<void>;
  getStoreToken(storeHash: string): Promise<string | undefined>;
  setStoreExtension(storeExtension: StoreExtensionRecord): Promise<void>;
  getStoreExtension(storeHash: string): Promise<string | undefined>;
  setStoreStorefrontScript(storeStorefrontScript: StoreStorefrontScriptRecord): Promise<void>;
  getStoreStorefrontScript(storeHash: string): Promise<string | undefined>;
  setStoreStorefrontPage(storeStorefrontPage: StoreStorefrontPageRecord): Promise<void>;
  getStoreStorefrontPage(storeHash: string): Promise<StoreStorefrontPageRecord | undefined>;
  setStoreWebhook(storeWebhook: StoreWebhookRecord): Promise<void>;
  getStoreWebhook(storeHash: string, scope: string): Promise<string | undefined>;
  isStoreUserLinked(storeHash: string, userId: number): Promise<boolean>;
  deleteStore(storeHash: string): Promise<void>;
  deleteUser(storeHash: string, userId: number): Promise<void>;
}
