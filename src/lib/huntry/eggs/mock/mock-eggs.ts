import { CreateEggInput, HuntryEgg, UpdateEggInput } from "@/lib/huntry/eggs/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

function mockEgg(id: string, eventId: number, rewardId: number, name: string, lat: number, lng: number): HuntryEgg {
  return {
    id,
    storeHash: "mock-store",
    rewardId,
    eventId,
    name,
    lat,
    lng,
    createdAt: daysFromNow(-3),
    updatedAt: daysFromNow(-3),
  };
}

// Clustered around the map's Stockholm default center, spread across the
// three MOCK_REWARDS (ids 1-3) and two MOCK_EVENTS (ids 1 and 3) so the
// reward-colored markers, the items panel's reward filter, and the
// per-event switch all have something to show. `let`, not `const` — the
// mutation helpers below replace the array, matching mock-rewards.ts.
export let MOCK_EGGS: HuntryEgg[] = [
  mockEgg("00000000-0000-4000-8000-000000000001", 1, 1, "Gamla Stan Egg", 59.3258, 18.0716),
  mockEgg("00000000-0000-4000-8000-000000000002", 1, 1, "Slussen Egg", 59.3199, 18.0723),
  mockEgg("00000000-0000-4000-8000-000000000003", 1, 2, "Kungsträdgården Egg", 59.3306, 18.0714),
  mockEgg("00000000-0000-4000-8000-000000000004", 1, 3, "Djurgården Egg", 59.3269, 18.1148),
  mockEgg("00000000-0000-4000-8000-000000000005", 3, 2, "Vasa Museum Egg", 59.3281, 18.0914),
  mockEgg("00000000-0000-4000-8000-000000000006", 3, 3, "Skansen Egg", 59.3249, 18.1038),
];

export function addMockEggs(inputs: CreateEggInput[]): HuntryEgg[] {
  const now = new Date();
  const created = inputs.map((input) => ({
    ...input,
    id: crypto.randomUUID(),
    storeHash: "mock-store",
    createdAt: now,
    updatedAt: now,
  }));

  MOCK_EGGS = [...MOCK_EGGS, ...created];

  return created;
}

// id/eventId/storeHash/createdAt are preserved — an egg's id is the join key
// for claims, so editing must never regenerate it.
export function updateMockEgg(id: string, input: UpdateEggInput): HuntryEgg | undefined {
  const existing = MOCK_EGGS.find((egg) => egg.id === id);

  if (!existing) {
    return undefined;
  }

  const updated: HuntryEgg = { ...existing, ...input, updatedAt: new Date() };

  MOCK_EGGS = MOCK_EGGS.map((egg) => (egg.id === id ? updated : egg));

  return updated;
}

export function deleteMockEgg(id: string): boolean {
  const before = MOCK_EGGS.length;

  MOCK_EGGS = MOCK_EGGS.filter((egg) => egg.id !== id);

  return MOCK_EGGS.length < before;
}
