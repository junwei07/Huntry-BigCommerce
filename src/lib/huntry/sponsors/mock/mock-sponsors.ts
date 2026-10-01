import { CreateSponsorInput, HuntrySponsor, UpdateSponsorInput } from "@/lib/huntry/sponsors/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

// Three fixtures covering the field variety a form will need to render
// correctly in BC-HUN-017: one with every field filled in, one with only a
// logo, and one with nothing but a name (exercising null-rendering for every
// optional field at once). `let`, not `const` — addMockSponsor below pushes
// newly "created" sponsors into this array, matching mock-events.ts's
// precedent for how MOCK mode simulates mutation within a process's lifetime.
export let MOCK_SPONSORS: HuntrySponsor[] = [
  {
    id: 1,
    storeHash: "mock-store",
    name: "Daybreak Coffee Roasters",
    logoUrl: "/huntry/cookies-banner.png",
    instagramUrl: "https://instagram.com/daybreakcoffee",
    facebookUrl: "https://facebook.com/daybreakcoffee",
    websiteUrl: "https://daybreakcoffee.example.com",
    location: "123 Main St, Springfield",
    createdAt: daysFromNow(-30),
    updatedAt: daysFromNow(-30),
  },
  {
    id: 2,
    storeHash: "mock-store",
    name: "Riverside Books",
    logoUrl: "/huntry/cookies-banner.png",
    instagramUrl: null,
    facebookUrl: null,
    websiteUrl: null,
    location: null,
    createdAt: daysFromNow(-10),
    updatedAt: daysFromNow(-10),
  },
  {
    id: 3,
    storeHash: "mock-store",
    name: "Corner Hardware",
    logoUrl: null,
    instagramUrl: null,
    facebookUrl: null,
    websiteUrl: null,
    location: null,
    createdAt: daysFromNow(-5),
    updatedAt: daysFromNow(-5),
  },
];

// Simulates creation in MOCK mode by pushing a new fixture into the in-memory
// array — ephemeral, resets on process restart. Huntry's own concepts are
// "MOCK-mode testable: Yes" per docs/MIGRATION.md §6, matching
// addMockEvent's precedent.
export function addMockSponsor(input: CreateSponsorInput): HuntrySponsor {
  const nextId = MOCK_SPONSORS.reduce((maxId, sponsor) => Math.max(maxId, sponsor.id), 0) + 1;
  const now = new Date();

  const sponsor: HuntrySponsor = {
    ...input,
    id: nextId,
    storeHash: "mock-store",
    createdAt: now,
    updatedAt: now,
  };

  MOCK_SPONSORS = [...MOCK_SPONSORS, sponsor];

  return sponsor;
}

// id/storeHash/createdAt are preserved; every other field is editable.
// Returns undefined if no fixture with this id exists, matching
// updateSponsorRow's "no row matched" behavior for the DB drivers.
export function updateMockSponsor(id: number, input: UpdateSponsorInput): HuntrySponsor | undefined {
  const existing = MOCK_SPONSORS.find((sponsor) => sponsor.id === id);

  if (!existing) {
    return undefined;
  }

  const updated: HuntrySponsor = { ...existing, ...input, updatedAt: new Date() };

  MOCK_SPONSORS = MOCK_SPONSORS.map((sponsor) => (sponsor.id === id ? updated : sponsor));

  return updated;
}

// A genuine hard delete, matching deleteSponsorRow's DB behavior — returns
// whether a fixture was actually removed. No MOCK_REWARDS exists yet to null
// out a sponsor_id reference against (rewards' own DAL is BC-HUN-018) — this
// is the same gap deleteSponsorRow's DB-backed branches close for real data.
export function deleteMockSponsor(id: number): boolean {
  const existedBefore = MOCK_SPONSORS.some((sponsor) => sponsor.id === id);

  MOCK_SPONSORS = MOCK_SPONSORS.filter((sponsor) => sponsor.id !== id);

  return existedBefore;
}
