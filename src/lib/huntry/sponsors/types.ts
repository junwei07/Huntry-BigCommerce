// Deliberately local rather than imported from events/types.ts — kept
// independent of the events DAL the same way events/types.ts stays independent
// of gift-certs-manager, rather than introducing a cross-import between
// sibling Huntry feature directories for a one-line type.
export type SortDirection = "ASC" | "DESC";

// camelCase, matching HuntryEvent's convention — our own schema, not a wire
// passthrough of an external API. huntry_sponsors has no BigCommerce-side
// counterpart at all (logo/social links/location only), so every field here
// maps 1:1 to a column with no derived/computed fields.
export interface HuntrySponsor {
  id: number;
  storeHash: string;
  name: string;
  logoUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
  location: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Sorted by name (alphabetical) — sponsors have no starts_at-like field to
// default-sort by the way events do.
export interface SponsorsQuery {
  direction: SortDirection;
}

// Every field a caller supplies to create a sponsor — unlike events, there's
// no slug, no derived status, and no hidden fields (isFeatured/featuredOrder)
// to preserve across an edit, so this is simply every column minus what the
// DB/normalizer assigns.
export type CreateSponsorInput = Omit<HuntrySponsor, "id" | "storeHash" | "createdAt" | "updatedAt">;

// Same editable field set as creation — a plain alias, matching
// UpdateEventInput's precedent.
export type UpdateSponsorInput = CreateSponsorInput;

// Every sponsor's logo until real image upload storage exists (BC-HUN-044)
// — the same placeholder asset events already use for headerBannerUrl. The
// create form offers a real upload *control* (LogoUploadField) despite this
// default, but nothing it picks is actually persisted yet; see
// docs/HUNTRY-UI-REFERENCE.md. Exported (not a private actions.ts constant
// like events' DEFAULT_EVENT_BANNER_URL) because both the Server Action and
// the client form need it.
export const DEFAULT_SPONSOR_LOGO_URL = "/huntry/cookies-banner.png";
