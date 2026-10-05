import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { CreateEventInput, DEFAULT_EVENT_THEME } from "@/lib/huntry/events/types";
import { CreateRewardInput } from "@/lib/huntry/rewards/types";

// BC-HUN-028: spy on the recompute so these tests assert which rewards each
// event trigger asks about, without a BigCommerce client (coupon-sync.test.ts
// covers the recompute itself). The real withUsageLimitWarning stays.
const recomputeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/huntry/rewards/coupon-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/huntry/rewards/coupon-sync")>()),
  recomputeRewardsUsageLimits: recomputeMock,
}));

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (nameOrOptions: string | { name: string }) => {
      cookieJar.delete(typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name);
    },
  })),
}));

let tempDir: string;

const USER_ID = 1;
const STORE = "store-a";

beforeEach(() => {
  cookieJar.clear();
  recomputeMock.mockReset().mockResolvedValue({ updated: 0, failed: [] });
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-events-id-actions-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  process.env.DATA_MODE = "MULTITENANT";
});

afterEach(() => {
  vi.resetModules();

  // Best-effort — DatabaseSync keeps its file handle open, which can lock the
  // temp dir on Windows.
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

async function authorize(storeHash: string) {
  const { SqliteCredentialsStore } = await import("@/lib/credentials-store/sqlite-driver/sqlite-credentials-store");
  const store = new SqliteCredentialsStore();

  await store.setUser({ userId: USER_ID, email: "admin@example.com" });
  await store.setStore({ storeHash, accessToken: "token", scope: "x", adminUserId: USER_ID });
  await store.setStoreUser({ storeHash, userId: USER_ID });

  const { signSession } = await import("@/lib/session/session-jwt");
  const { SESSION_COOKIE_NAME } = await import("@/lib/session/types");

  cookieJar.set(
    SESSION_COOKIE_NAME,
    await signSession({ userId: USER_ID, authenticatedStores: [storeHash], issuedAt: Math.floor(Date.now() / 1000) }),
  );
}

const EVENT_INPUT: CreateEventInput = {
  name: "Spring Hunt",
  description: "",
  startsAt: null,
  endsAt: null,
  headerBannerUrl: null,
  markerRadiusMeters: 20,
  maxGrabCount: 1,
  eggClaimCapacity: 2,
  theme: DEFAULT_EVENT_THEME,
  isFeatured: false,
  featuredOrder: null,
};

const rewardInput = (name: string): CreateRewardInput => ({
  name,
  description: "",
  sponsorId: null,
  couponCode: name.toUpperCase().replace(/\W/g, ""),
  eggCapacity: 5,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
});

const formInput = (eggClaimCapacity: number, name = "Spring Hunt"): EventFormInput => ({
  name,
  startsAt: "2030-01-01T00:00",
  endsAt: "2030-01-02T00:00",
  description: "A hunt",
  markerRadiusMeters: "20",
  maxGrabCount: "1",
  eggClaimCapacity: String(eggClaimCapacity),
  itemMarker: DEFAULT_EVENT_THEME.itemMarker,
  locationMarker: DEFAULT_EVENT_THEME.locationMarker,
  themeColors: DEFAULT_EVENT_THEME.colors,
});

// Two rewards with eggs in the event, plus a third reward with none.
async function seed() {
  const { createEvent } = await import("@/lib/huntry/events/events-api");
  const { createReward } = await import("@/lib/huntry/rewards/rewards-api");
  const { createEggs } = await import("@/lib/huntry/eggs/eggs-api");
  const event = await createEvent(EVENT_INPUT, STORE);
  const first = await createReward(rewardInput("First"), STORE);
  const second = await createReward(rewardInput("Second"), STORE);
  const unplaced = await createReward(rewardInput("Unplaced"), STORE);

  await createEggs(
    [
      { eventId: event.id, rewardId: first.id, name: "A", lat: 59, lng: 18 },
      { eventId: event.id, rewardId: first.id, name: "B", lat: 59.01, lng: 18 },
      { eventId: event.id, rewardId: second.id, name: "C", lat: 59.02, lng: 18 },
    ],
    STORE,
  );

  return { event, first, second, unplaced };
}

describe("updateHuntryEvent usage-limit recompute", () => {
  it("recomputes every reward with an egg in the event when eggClaimCapacity changes", async () => {
    await authorize(STORE);

    const { event, first, second } = await seed();
    const { updateHuntryEvent } = await import("@/app/store/[storeHash]/huntry/events/[id]/actions");

    const result = await updateHuntryEvent(event.id, formInput(9), STORE);

    expect(result.success).toBe(true);
    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect([...recomputeMock.mock.calls[0][0]].sort()).toEqual([first.id, second.id].sort());
  });

  it("does not recompute when eggClaimCapacity is unchanged", async () => {
    await authorize(STORE);

    const { event } = await seed();
    const { updateHuntryEvent } = await import("@/app/store/[storeHash]/huntry/events/[id]/actions");

    const result = await updateHuntryEvent(event.id, formInput(2, "Renamed Hunt"), STORE);

    expect(result.success).toBe(true);
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("surfaces a recompute failure as a warning while keeping the event update", async () => {
    await authorize(STORE);
    recomputeMock.mockResolvedValue({ updated: 0, failed: [{ rewardId: 1, message: "rate limited" }] });

    const { event } = await seed();
    const { updateHuntryEvent } = await import("@/app/store/[storeHash]/huntry/events/[id]/actions");
    const { fetchEventUncached } = await import("@/lib/huntry/events/events-api");

    const result = await updateHuntryEvent(event.id, formInput(9), STORE);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/updated\..*usage limit failed/);
    expect((await fetchEventUncached(event.id, STORE))?.eggClaimCapacity).toBe(9);
  });
});

describe("deleteHuntryEvent usage-limit recompute", () => {
  it("recomputes the rewards captured before the cascade removed the eggs", async () => {
    await authorize(STORE);

    const { event, first, second } = await seed();
    const { deleteHuntryEvent } = await import("@/app/store/[storeHash]/huntry/events/[id]/actions");
    const { fetchEggsUncached } = await import("@/lib/huntry/eggs/eggs-api");

    const result = await deleteHuntryEvent(event.id, STORE);

    expect(result.success).toBe(true);
    expect(await fetchEggsUncached(event.id, STORE)).toHaveLength(0);
    expect([...recomputeMock.mock.calls[0][0]].sort()).toEqual([first.id, second.id].sort());
  });

  it("does not recompute when the event was already gone", async () => {
    await authorize(STORE);

    const { event } = await seed();
    const { deleteHuntryEvent } = await import("@/app/store/[storeHash]/huntry/events/[id]/actions");

    await deleteHuntryEvent(event.id, STORE);
    recomputeMock.mockClear();

    const result = await deleteHuntryEvent(event.id, STORE);

    expect(result.success).toBe(false);
    expect(recomputeMock).not.toHaveBeenCalled();
  });
});
