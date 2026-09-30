import { EventFields } from "@/lib/huntry/events/types";

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
export const MOCK_EVENTS: EventFields[] = [
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
    theme: {},
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
    headerBannerUrl: null,
    markerRadiusMeters: 25,
    maxGrabCount: 3,
    eggClaimCapacity: 1,
    theme: {},
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
    headerBannerUrl: null,
    markerRadiusMeters: 30,
    maxGrabCount: 0,
    eggClaimCapacity: 2,
    theme: {},
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
    theme: {},
    isFeatured: false,
    featuredOrder: null,
    createdAt: daysFromNow(-90),
    updatedAt: daysFromNow(-70),
  },
];
