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
