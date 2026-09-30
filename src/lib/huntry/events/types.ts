// Deliberately local rather than imported from
// gift-certs-manager/customers/types.ts — Huntry code shouldn't depend on
// the example feature slated for removal.
export type SortDirection = "ASC" | "DESC";

// Derived from starts_at/ends_at at read time — huntry_events has no status
// column at all (see db/migrations/0001_huntry_schema.sql). Mirrors the
// WordPress plugin's huntry_compute_event_status(): no starts_at at all is
// "not-scheduled" (hyphenated here, unlike the plugin's "not scheduled").
export type EventStatus = "not-scheduled" | "upcoming" | "live" | "ended";

// camelCase, unlike GiftCertificate — this is our own schema, not a
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
  theme: Record<string, unknown>;
  isFeatured: boolean;
  featuredOrder: number | null;
  createdAt: Date;
  updatedAt: Date;
  status: EventStatus;
}

// No text/status filters yet — nothing in tickets.md requests events list
// filtering (unlike gift-certs, which gets its own filtering enhancement).
// This is a placeholder ready for a future ticket to extend.
export interface EventsQuery {
  direction: SortDirection;
}

// Every HuntryEvent field except the computed status — the shape each
// driver's row-normalizer (events-api.ts) and the mock fixtures
// (mock/mock-events.ts) produce, before status is derived and added.
export type EventFields = Omit<HuntryEvent, "status">;
