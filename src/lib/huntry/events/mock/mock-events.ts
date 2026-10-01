import {
  CreateEventInput,
  DEFAULT_ITEM_MARKER,
  DEFAULT_LOCATION_MARKER,
  EVENT_THEME_PRESETS,
  EventFields,
  UpdateEventInput,
} from "@/lib/huntry/events/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Dates are computed relative to module-load time rather than hardcoded, so
// these fixtures stay correct indefinitely instead of drifting stale (e.g.
// an "upcoming" event dated to a fixed calendar date would eventually
// become "ended").
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

// One fixture per derived status (not-scheduled/upcoming/live/ended), so
// MOCK mode exercises the same status variety a real store would show.
// `let`, not `const` — addMockEvent below pushes newly "created" events into
// this array, so MOCK mode's fetchEvents/fetchEvent reflect creation within
// a process's lifetime (see events-api.ts's createEvent and
// docs/HUNTRY-UI-REFERENCE.md).
export let MOCK_EVENTS: EventFields[] = [
  {
    id: 1,
    storeHash: "mock-store",
    name: "Spring Scavenger Hunt",
    slug: "spring-scavenger-hunt",
    description: "A springtime hunt around downtown.",
    startsAt: null,
    endsAt: null,
    headerBannerUrl: null,
    markerRadiusMeters: 25,
    maxGrabCount: 0,
    eggClaimCapacity: 1,
    theme: { colors: EVENT_THEME_PRESETS[0], itemMarker: DEFAULT_ITEM_MARKER, locationMarker: DEFAULT_LOCATION_MARKER },
    isFeatured: false,
    featuredOrder: null,
    createdAt: daysFromNow(-30),
    updatedAt: daysFromNow(-30),
  },
  {
    id: 2,
    storeHash: "mock-store",
    name: "Summer Kickoff Hunt",
    slug: "summer-kickoff-hunt",
    description: "Kicking off summer with prizes across the mall.",
    startsAt: daysFromNow(7),
    endsAt: daysFromNow(14),
    headerBannerUrl: "/huntry/cookies-banner.png",
    markerRadiusMeters: 25,
    maxGrabCount: 3,
    eggClaimCapacity: 1,
    theme: {
      colors: EVENT_THEME_PRESETS[1],
      itemMarker: { source: "preset", presetIndex: 3, unclaimedIconUrl: null, claimedIconUrl: null },
      locationMarker: { source: "preset", presetIndex: 1, iconUrl: null },
    },
    isFeatured: true,
    featuredOrder: 1,
    createdAt: daysFromNow(-10),
    updatedAt: daysFromNow(-10),
  },
  {
    id: 3,
    storeHash: "mock-store",
    name: "Anniversary Hunt",
    slug: "anniversary-hunt",
    description: "Celebrating another year in business.",
    startsAt: daysFromNow(-1),
    endsAt: daysFromNow(6),
    headerBannerUrl: "/huntry/cookies-banner.png",
    markerRadiusMeters: 30,
    maxGrabCount: 5,
    eggClaimCapacity: 2,
    theme: { colors: EVENT_THEME_PRESETS[2], itemMarker: DEFAULT_ITEM_MARKER, locationMarker: DEFAULT_LOCATION_MARKER },
    isFeatured: true,
    featuredOrder: 0,
    createdAt: daysFromNow(-5),
    updatedAt: daysFromNow(-5),
  },
  {
    id: 4,
    storeHash: "mock-store",
    name: "Winter Wrap-Up Hunt",
    slug: "winter-wrap-up-hunt",
    description: "Last hunt of the season.",
    startsAt: daysFromNow(-60),
    endsAt: daysFromNow(-45),
    headerBannerUrl: null,
    markerRadiusMeters: 25,
    maxGrabCount: 1,
    eggClaimCapacity: 1,
    theme: { colors: EVENT_THEME_PRESETS[3], itemMarker: DEFAULT_ITEM_MARKER, locationMarker: DEFAULT_LOCATION_MARKER },
    isFeatured: false,
    featuredOrder: null,
    createdAt: daysFromNow(-90),
    updatedAt: daysFromNow(-70),
  },
];

// Simulates creation in MOCK mode by pushing a new fixture into the
// in-memory array — ephemeral, resets on process restart, matching "in
// -memory mock data." Unlike gift-certs-manager's mutations (which have no
// MOCK support at all, since gift certificates are BigCommerce-sourced with
// nothing local to mutate), docs/MIGRATION.md §6 states Phase 1 admin CRUD
// for Huntry's own concepts is "MOCK-mode testable: Yes," which requires
// creation to actually work here.
// slug is supplied by the caller (events-api.ts's createEvent), already
// deduped against MOCK_EVENTS's existing slugs — there's no slug form
// field, so nothing here computes one itself.
export function addMockEvent(input: CreateEventInput & { slug: string }): EventFields {
  const nextId = MOCK_EVENTS.reduce((maxId, event) => Math.max(maxId, event.id), 0) + 1;
  const now = new Date();

  const event: EventFields = {
    ...input,
    id: nextId,
    storeHash: "mock-store",
    createdAt: now,
    updatedAt: now,
  };

  MOCK_EVENTS = [...MOCK_EVENTS, event];

  return event;
}

// slug/id/storeHash/createdAt are preserved — slug never changes on edit
// (see events-api.ts's updateEvent), the rest are immutable identity/audit
// fields. Returns undefined if no fixture with this id exists, matching
// updateEventRow's "no row matched" behavior for the DB drivers.
export function updateMockEvent(id: number, input: UpdateEventInput): EventFields | undefined {
  const existing = MOCK_EVENTS.find((event) => event.id === id);

  if (!existing) {
    return undefined;
  }

  const updated: EventFields = { ...existing, ...input, updatedAt: new Date() };

  MOCK_EVENTS = MOCK_EVENTS.map((event) => (event.id === id ? updated : event));

  return updated;
}

// A genuine hard delete, matching deleteEventRow's DB behavior — returns
// whether a fixture was actually removed.
export function deleteMockEvent(id: number): boolean {
  const existedBefore = MOCK_EVENTS.some((event) => event.id === id);

  MOCK_EVENTS = MOCK_EVENTS.filter((event) => event.id !== id);

  return existedBefore;
}
