// Deliberately local rather than imported from another feature's types.
// Both options sort ascending: "name" is A-Z, "time" is soonest start first
// (unscheduled events last).
export type EventSort = "name" | "time";

// Derived from starts_at/ends_at at read time — huntry_events has no status
// column at all (see db/migrations/0001_huntry_schema.sql). Mirrors the
// WordPress plugin's huntry_compute_event_status(): no starts_at at all is
// "not-scheduled" (hyphenated here, unlike the plugin's "not scheduled").
export type EventStatus = "not-scheduled" | "upcoming" | "live" | "ended";

// Event card branding: either one of EVENT_THEME_PRESETS (preset holds its
// index) or a hand-picked "Custom" combination (preset: null). preset is
// persisted explicitly rather than re-derived by string-matching the colors
// against the presets on load, unlike the WP plugin source this is modeled
// on (huntry/includes/events/index.php's huntry_get_event_theme_presets())
// — see docs/HUNTRY-UI-REFERENCE.md.
export interface EventThemeColors {
  preset: number | null;
  primaryColor: string;
  successColor: string;
}

// The 6 preset primary/success pairs from huntry_get_event_theme_presets(),
// ported directly (Orange is the plugin's own documented default).
export const EVENT_THEME_PRESETS: EventThemeColors[] = [
  { preset: 0, primaryColor: "#f7a163", successColor: "#5dc564" }, // Orange (Default)
  { preset: 1, primaryColor: "#4da3ff", successColor: "#e26d14" }, // Blue
  { preset: 2, primaryColor: "#ff6b5b", successColor: "#4caf50" }, // Coral
  { preset: 3, primaryColor: "#a875f5", successColor: "#34c77b" }, // Purple
  { preset: 4, primaryColor: "#f5c518", successColor: "#3c5522" }, // Gold
  { preset: 5, primaryColor: "#2ec4b6", successColor: "#10462d" }, // Teal
];

export const DEFAULT_EVENT_THEME_COLORS: EventThemeColors = EVENT_THEME_PRESETS[0];

// The linked unclaimed+claimed icon pair for map markers — picked together
// as one preset (huntry_render_event_details_meta_box()'s "Item markers"
// section), or a custom URL pair. No real file upload exists in this
// starter (no object storage — see docs/MIGRATION.md §8, same reasoning as
// headerBannerUrl), so "custom" is a URL input, not an upload widget.
export interface EventItemMarker {
  source: "preset" | "custom";
  presetIndex: number | null;
  unclaimedIconUrl: string | null;
  claimedIconUrl: string | null;
}

export const ITEM_MARKER_PRESET_COUNT = 18;

export function getItemMarkerPresetUrls(presetIndex: number): { unclaimedUrl: string; claimedUrl: string } {
  return {
    unclaimedUrl: `/huntry/markers/item/sample_${presetIndex}.png`,
    claimedUrl: `/huntry/markers/item/sample_${presetIndex}_claimed.png`,
  };
}

export const DEFAULT_ITEM_MARKER: EventItemMarker = {
  source: "preset",
  presetIndex: null,
  unclaimedIconUrl: null,
  claimedIconUrl: null,
};

// The player's own current-location marker on the map — same
// preset-or-custom-URL structure as EventItemMarker, one icon instead of a
// pair.
export interface EventLocationMarker {
  source: "preset" | "custom";
  presetIndex: number | null;
  iconUrl: string | null;
}

export const LOCATION_MARKER_PRESET_COUNT = 4;

export function getLocationMarkerPresetUrl(presetIndex: number): string {
  return `/huntry/markers/location/current_marker_${presetIndex}.png`;
}

export const DEFAULT_LOCATION_MARKER: EventLocationMarker = {
  source: "preset",
  presetIndex: null,
  iconUrl: null,
};

// The full theme JSONB shape — docs/MIGRATION.md's own column comment
// ("marker/theme colors, custom icon URLs") folds all three of the WP
// form's marker/color sections into this one column, rather than separate
// typed columns.
export interface EventTheme {
  colors: EventThemeColors;
  itemMarker: EventItemMarker;
  locationMarker: EventLocationMarker;
}

export const DEFAULT_EVENT_THEME: EventTheme = {
  colors: DEFAULT_EVENT_THEME_COLORS,
  itemMarker: DEFAULT_ITEM_MARKER,
  locationMarker: DEFAULT_LOCATION_MARKER,
};

// camelCase — this is our own schema, not a
// passthrough of an external wire format, so it follows CredentialsStore's
// convention (StoreRecord.storeHash etc.) instead. See events-api.ts for the
// snake_case row -> this mapping.
export interface HuntryEvent {
  id: number;
  storeHash: string;
  name: string;
  slug: string;
  description: string;
  startsAt: Date | null;
  endsAt: Date | null;
  headerBannerUrl: string | null;
  markerRadiusMeters: number;
  maxGrabCount: number;
  eggClaimCapacity: number;
  theme: EventTheme;
  isFeatured: boolean;
  featuredOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
  status: EventStatus;
}

// No text/status filters yet — nothing in tickets.md requests events list
// filtering.
// This is a placeholder ready for a future ticket to extend.
export interface EventsQuery {
  sort: EventSort;
}

// Every HuntryEvent field except the computed status — the shape each
// driver's row-normalizer (events-api.ts) and the mock fixtures
// (mock/mock-events.ts) produce, before status is derived and added.
export type EventFields = Omit<HuntryEvent, "status">;

// The fields a caller supplies to create an event — everything except what
// the DB/normalizer assigns (id, storeHash comes from the caller's session,
// not the form; createdAt/updatedAt are DB-assigned) and slug, which is
// computed server-side from name (WordPress-style — see events-api.ts's
// createEvent and docs/HUNTRY-UI-REFERENCE.md), never user-typed.
export type CreateEventInput = Omit<EventFields, "id" | "storeHash" | "slug" | "createdAt" | "updatedAt">;

// Same editable field set as creation — slug still never changes (it's an
// internal identifier, not user-facing either way), so editing name never
// touches it. A plain alias rather than a separate interface: the two are
// identical today and would only need to diverge if an edit-only field
// ever appears.
export type UpdateEventInput = CreateEventInput;

// Header banner for an event with no uploaded image (BC-HUN-044): a bundled
// public/ asset, the same placeholder sponsors use for their logo.
export const DEFAULT_EVENT_BANNER_URL = "/huntry/cookies-banner.png";
