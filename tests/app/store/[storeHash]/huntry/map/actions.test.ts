import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateEventInput, DEFAULT_EVENT_THEME } from "@/lib/huntry/events/types";
import { CreateRewardInput } from "@/lib/huntry/rewards/types";

// Same Next.js request-context mocks as the rewards actions tests.
vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
}));

// BC-HUN-028: spy on the recompute so these tests can assert which rewards
// each trigger asks about without a BigCommerce client (coupon-sync.test.ts
// covers the recompute itself). The real withUsageLimitWarning stays.
const recomputeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/huntry/rewards/coupon-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/huntry/rewards/coupon-sync")>()),
  recomputeRewardsUsageLimits: recomputeMock,
}));

// BC-HUN-032: a forced claim issues its own single-use code (the reward's
// shared code no longer exists in BigCommerce). Stub both BigCommerce-facing
// collaborators; claim-codes.test.ts covers the code issuing itself.
const issueCodeMock = vi.hoisted(() => vi.fn());
const customersMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/huntry/rewards/claim-codes", () => ({ issueClaimCode: issueCodeMock }));
vi.mock("@/lib/gift-certs-manager/customers/customers-api", () => ({ fetchCustomersByEmailUncached: customersMock }));

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
const OTHER_STORE = "store-b";

beforeEach(() => {
  cookieJar.clear();
  recomputeMock.mockReset().mockResolvedValue({ updated: 0, failed: [] });
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-map-actions-test-"));
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
  eggClaimCapacity: 1,
  theme: DEFAULT_EVENT_THEME,
  isFeatured: false,
  featuredOrder: null,
};

const rewardInput = (name: string, eggCapacity: number): CreateRewardInput => ({
  name,
  description: "",
  sponsorId: null,
  couponCode: name.toUpperCase().replace(/\W/g, ""),
  eggCapacity,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
});

// ~0.001 degrees of latitude is ~111m, well beyond the 20m radius.
const spot = (step: number) => ({ lat: 59 + step * 0.001, lng: 18 });

async function seed() {
  const { createEvent } = await import("@/lib/huntry/events/events-api");
  const { createReward } = await import("@/lib/huntry/rewards/rewards-api");
  const event = await createEvent(EVENT_INPUT, STORE);
  const roomy = await createReward(rewardInput("Roomy", 5), STORE);
  const tiny = await createReward(rewardInput("Tiny", 1), STORE);

  return { event, roomy, tiny };
}

describe("saveHuntryEggPlacements", () => {
  it("rejects an unauthorized store without writing", async () => {
    const { event, roomy } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggsUncached } = await import("@/lib/huntry/eggs/eggs-api");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");

    const result = await saveHuntryEggPlacements(event.id, [{ rewardId: roomy.id, name: "", ...spot(0) }], STORE);

    expect(result).toEqual({ success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE });
    expect(await fetchEggsUncached(event.id, STORE)).toHaveLength(0);
  });

  it("places eggs with app-generated ids and auto-names blank ones from the event name", async () => {
    await authorize(STORE);

    const { event, roomy } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggsUncached } = await import("@/lib/huntry/eggs/eggs-api");

    const result = await saveHuntryEggPlacements(
      event.id,
      [
        { rewardId: roomy.id, name: "", ...spot(0) },
        { rewardId: roomy.id, name: "Typed", ...spot(1) },
      ],
      STORE,
    );
    const eggs = await fetchEggsUncached(event.id, STORE);

    expect(result).toEqual({ success: true, message: "2 eggs placed." });
    expect(eggs.map((egg) => egg.name).sort()).toEqual(["Spring Hunt 1", "Typed"]);
    expect(eggs.every((egg) => /^[0-9a-f-]{36}$/.test(egg.id))).toBe(true);
  });

  it("skips too-close and over-capacity adds but still saves the rest, reporting the skips", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggsUncached } = await import("@/lib/huntry/eggs/eggs-api");

    const result = await saveHuntryEggPlacements(
      event.id,
      [
        { rewardId: roomy.id, name: "A", ...spot(0) },
        { rewardId: roomy.id, name: "TooClose", ...spot(0) },
        { rewardId: tiny.id, name: "B", ...spot(1) },
        { rewardId: tiny.id, name: "OverCapacity", ...spot(2) },
      ],
      STORE,
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe("2 eggs placed. 2 skipped — 1 too close to another egg, 1 over a reward or event egg limit.");
    expect((await fetchEggsUncached(event.id, STORE)).map((egg) => egg.name).sort()).toEqual(["A", "B"]);
  });

  it("reports a fully-skipped batch as a failure", async () => {
    await authorize(STORE);

    const { event, tiny } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await saveHuntryEggPlacements(event.id, [{ rewardId: tiny.id, name: "", ...spot(0) }], STORE);

    const result = await saveHuntryEggPlacements(event.id, [{ rewardId: tiny.id, name: "", ...spot(5) }], STORE);

    expect(result.success).toBe(false);
  });
});

describe("updateHuntryEgg", () => {
  async function placeOne(rewardId: number, eventId: number, step: number, name = "Egg") {
    const { createEggs } = await import("@/lib/huntry/eggs/eggs-api");

    return (await createEggs([{ eventId, rewardId, name, ...spot(step) }], STORE))[0];
  }

  it("keeps the egg id while changing name, reward and location", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0);
    const { updateHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggUncached } = await import("@/lib/huntry/eggs/eggs-api");

    const result = await updateHuntryEgg(egg.id, { rewardId: tiny.id, name: "Renamed", ...spot(3) }, STORE);
    const updated = await fetchEggUncached(egg.id, STORE);

    expect(result.success).toBe(true);
    expect(updated).toMatchObject({ id: egg.id, eventId: event.id, rewardId: tiny.id, name: "Renamed", ...spot(3) });
    expect(updated?.createdAt).toEqual(egg.createdAt);
  });

  it("keeps the existing name when the submitted one is blank", async () => {
    await authorize(STORE);

    const { event, roomy } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0, "Original");
    const { updateHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggUncached } = await import("@/lib/huntry/eggs/eggs-api");

    await updateHuntryEgg(egg.id, { rewardId: roomy.id, name: "" }, STORE);

    expect((await fetchEggUncached(egg.id, STORE))?.name).toBe("Original");
  });

  it("rejects a relocation too close to another egg, and a reward with no room", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();

    await placeOne(roomy.id, event.id, 0, "Neighbor");
    await placeOne(tiny.id, event.id, 1, "Fills Tiny");

    const egg = await placeOne(roomy.id, event.id, 2, "Mover");
    const { updateHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    const tooClose = await updateHuntryEgg(egg.id, { rewardId: roomy.id, name: "Mover", ...spot(0) }, STORE);
    const noRoom = await updateHuntryEgg(egg.id, { rewardId: tiny.id, name: "Mover" }, STORE);

    expect(tooClose.success).toBe(false);
    expect(tooClose.message).toMatch(/too close/i);
    expect(noRoom.success).toBe(false);
    expect(noRoom.message).toMatch(/no room/i);
  });

  it("never exposes another store's egg", async () => {
    const { event, roomy } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0);
    const { fetchEggUncached, deleteEgg } = await import("@/lib/huntry/eggs/eggs-api");

    expect(await fetchEggUncached(egg.id, OTHER_STORE)).toBeUndefined();
    expect(await deleteEgg(egg.id, OTHER_STORE)).toBe(false);
    expect(await fetchEggUncached(egg.id, STORE)).toBeDefined();
  });
});

describe("deleteHuntryEgg", () => {
  it("hard-deletes the egg, and a second delete reports it gone", async () => {
    await authorize(STORE);

    const { event, roomy } = await seed();
    const { createEggs, fetchEggUncached } = await import("@/lib/huntry/eggs/eggs-api");
    const [egg] = await createEggs([{ eventId: event.id, rewardId: roomy.id, name: "Doomed", ...spot(0) }], STORE);
    const { deleteHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    expect(await deleteHuntryEgg(egg.id, STORE)).toEqual({ success: true, message: "Egg deleted." });
    expect(await fetchEggUncached(egg.id, STORE)).toBeUndefined();
    expect((await deleteHuntryEgg(egg.id, STORE)).success).toBe(false);
  });
});

// BC-HUN-028
describe("usage-limit recompute triggers", () => {
  async function placeOne(rewardId: number, eventId: number, step: number) {
    const { createEggs } = await import("@/lib/huntry/eggs/eggs-api");

    return (await createEggs([{ eventId, rewardId, name: "Egg", ...spot(step) }], STORE))[0];
  }

  it("recomputes each distinct reward once after a placement batch", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await saveHuntryEggPlacements(
      event.id,
      [
        { rewardId: roomy.id, name: "A", ...spot(0) },
        { rewardId: roomy.id, name: "B", ...spot(1) },
        { rewardId: tiny.id, name: "C", ...spot(2) },
      ],
      STORE,
    );

    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect([...recomputeMock.mock.calls[0][0]].sort()).toEqual([roomy.id, roomy.id, tiny.id].sort());
    expect(recomputeMock.mock.calls[0][1]).toBe(STORE);
  });

  it("only recomputes rewards whose eggs were actually accepted", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await saveHuntryEggPlacements(
      event.id,
      [
        { rewardId: roomy.id, name: "A", ...spot(0) },
        { rewardId: tiny.id, name: "TooClose", ...spot(0) },
      ],
      STORE,
    );

    expect(recomputeMock.mock.calls[0][0]).toEqual([roomy.id]);
  });

  it("surfaces a recompute failure as a warning without undoing the placement", async () => {
    await authorize(STORE);
    recomputeMock.mockResolvedValue({ updated: 0, failed: [{ rewardId: 1, message: "rate limited" }] });

    const { event, roomy } = await seed();
    const { saveHuntryEggPlacements } = await import("@/app/store/[storeHash]/huntry/map/actions");
    const { fetchEggsUncached } = await import("@/lib/huntry/eggs/eggs-api");

    const result = await saveHuntryEggPlacements(event.id, [{ rewardId: roomy.id, name: "A", ...spot(0) }], STORE);

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/1 egg placed\..*usage limit failed/);
    expect(await fetchEggsUncached(event.id, STORE)).toHaveLength(1);
  });

  it("recomputes both the old and new reward when an egg changes reward", async () => {
    await authorize(STORE);

    const { event, roomy, tiny } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0);
    const { updateHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await updateHuntryEgg(egg.id, { rewardId: tiny.id, name: "Egg" }, STORE);

    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect(recomputeMock.mock.calls[0][0]).toEqual([roomy.id, tiny.id]);
  });

  it("does not recompute when an egg is only renamed or relocated", async () => {
    await authorize(STORE);

    const { event, roomy } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0);
    const { updateHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await updateHuntryEgg(egg.id, { rewardId: roomy.id, name: "Renamed", ...spot(4) }, STORE);

    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("recomputes the egg's reward after a delete, and not for an already-gone egg", async () => {
    await authorize(STORE);

    const { event, roomy } = await seed();
    const egg = await placeOne(roomy.id, event.id, 0);
    const { deleteHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    await deleteHuntryEgg(egg.id, STORE);
    await deleteHuntryEgg(egg.id, STORE);

    expect(recomputeMock).toHaveBeenCalledTimes(1);
    expect(recomputeMock.mock.calls[0][0]).toEqual([roomy.id]);
  });
});

describe("forceClaimHuntryEgg", () => {
  async function placeEgg() {
    const { event, roomy } = await seed();
    const { createEggs } = await import("@/lib/huntry/eggs/eggs-api");
    const [egg] = await createEggs([{ rewardId: roomy.id, eventId: event.id, name: "Egg", ...spot(0) }], STORE);

    return { egg, roomy };
  }

  async function claimRows() {
    const { getHuntryDb } = await import("@/lib/huntry/db/get-db");

    return (getHuntryDb() as import("node:sqlite").DatabaseSync)
      .prepare("SELECT coupon_code, is_forced, bc_customer_id FROM huntry_claims")
      .all() as { coupon_code: string; is_forced: number; bc_customer_id: number }[];
  }

  beforeEach(() => {
    issueCodeMock.mockReset().mockResolvedValue("ROOMY-ABCD2345");
    customersMock.mockReset().mockResolvedValue({ items: [{ id: 77, email: "player@example.com" }] });
  });

  it("stores a freshly issued per-claim code, not the reward's shared prefix", async () => {
    await authorize(STORE);

    const { egg, roomy } = await placeEgg();
    const { forceClaimHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    const result = await forceClaimHuntryEgg(egg.id, "player@example.com", STORE);

    expect(result.success).toBe(true);
    expect(issueCodeMock).toHaveBeenCalledWith(expect.objectContaining({ id: roomy.id }), STORE);
    expect(await claimRows()).toEqual([{ coupon_code: "ROOMY-ABCD2345", is_forced: 1, bc_customer_id: 77 }]);
  });

  it("writes no claim when the code cannot be issued", async () => {
    await authorize(STORE);
    issueCodeMock.mockRejectedValue(new Error("BigCommerce down"));

    const { egg } = await placeEgg();
    const { forceClaimHuntryEgg } = await import("@/app/store/[storeHash]/huntry/map/actions");

    expect((await forceClaimHuntryEgg(egg.id, "player@example.com", STORE)).success).toBe(false);
    expect(await claimRows()).toEqual([]);
  });
});
