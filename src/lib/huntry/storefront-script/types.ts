// Client-side view of GET .../map-data. Mirrors PublicMapData in
// src/lib/huntry/public-api/map-data.ts, except dates arrive as ISO strings
// after JSON serialization. Declared here rather than imported so the bundle
// never pulls server modules into its import graph.
export interface StorefrontEgg {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rewardName: string;
  isFull: boolean;
}

export interface StorefrontEvent {
  id: number;
  name: string;
  slug: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  headerBannerUrl: string | null;
  markerRadiusMeters: number;
  maxGrabCount: number;
  eggClaimCapacity: number;
  colors: { primaryColor: string; successColor: string };
  unclaimedIconUrl: string | null;
  claimedIconUrl: string | null;
  locationIconUrl: string | null;
  locationAnchor: "bottom" | "center";
  eggs: StorefrontEgg[];
}

export interface StorefrontMapData {
  events: StorefrontEvent[];
}

// Injected by storefront-script.js/route.ts as window.__HUNTRY_STOREFRONT__.
export interface StorefrontConfig {
  appOrigin: string;
  storeHash: string;
  clientId: string;
}

// Per-player egg flags, persisted per event in local-state.ts. "Full" is not
// here: it comes from the public map-data (StorefrontEgg.isFull).
export interface EggFlags {
  skipped: ReadonlySet<string>;
  dismissed: ReadonlySet<string>;
  claimedDismissed: ReadonlySet<string>;
  mine: ReadonlySet<string>;
}

// The same four sets, mutable. The map owns the live instances and shares them
// through HuntryMapApi.flags, so the claim dialogs change what the map's
// proximity checks see instead of editing a private copy.
export type MutableEggFlags = { [K in keyof EggFlags]: Set<string> };
