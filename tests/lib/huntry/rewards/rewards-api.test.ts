import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { createEvent } from "@/lib/huntry/events/events-api";
import { DEFAULT_EVENT_THEME } from "@/lib/huntry/events/types";
import {
  createReward,
  deleteReward,
  fetchBcProductsForPicker,
  fetchReward,
  fetchRewardUncached,
  updateReward,
} from "@/lib/huntry/rewards/rewards-api";
import { CreateRewardInput } from "@/lib/huntry/rewards/types";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-rewards-api-test-"));
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  delete process.env.CREDENTIALS_STORE_DRIVER;
});

afterAll(() => {
  // Best-effort rather than asserted — see
  // tests/lib/session/is-authorized-for-store.test.ts's afterEach:
  // DatabaseSync keeps its file handle open, which can lock the temp dir on
  // Windows.
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

const baseInput: CreateRewardInput = {
  name: "Test Reward",
  description: "desc",
  sponsorId: null,
  couponCode: "TESTREWARD",
  eggCapacity: 5,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
};

describe("rewards-api (SQLite)", () => {
  it("creates a reward scoped to a store, with no products for discountScope 'all'", async () => {
    const reward = await createReward(baseInput, "store-a");

    expect(reward.storeHash).toBe("store-a");
    expect(reward.productIds).toEqual([]);
    expect(reward.status).toBe("active");
    expect(reward.discountValue).toBe(10);
  });

  it("creates a 'specific'-scope reward with product associations and round-trips them", async () => {
    const reward = await createReward(
      { ...baseInput, name: "Specific Reward", couponCode: "SPECIFICREWARD", discountScope: "specific", productIds: [201, 202] },
      "store-a",
    );

    expect([...reward.productIds].sort()).toEqual([201, 202]);

    // fetchReward's cached wrapper requires Next's Cache Components runtime
    // (cacheLife() throws outside it) — the same limitation documented for
    // events'/sponsors' own DAL verification. fetchRewardUncached shares
    // selectRewardRow with it, so this exercises the identical SQL/row-shape/
    // product-join logic.
    const fetched = await fetchRewardUncached(reward.id, "store-a");

    expect([...(fetched?.productIds ?? [])].sort()).toEqual([201, 202]);
  });

  it("enforces store isolation on update/delete", async () => {
    const reward = await createReward({ ...baseInput, name: "Isolated Reward", couponCode: "ISOLATEDREWARD" }, "store-a");

    const updatedWrongStore = await updateReward(
      reward.id,
      { ...baseInput, name: "Hacked", couponCode: "ISOLATEDREWARD" },
      "store-b",
    );

    expect(updatedWrongStore).toBeUndefined();

    const deletedWrongStore = await deleteReward(reward.id, "store-b");

    expect(deletedWrongStore).toBe(false);

    const stillThere = await fetchRewardUncached(reward.id, "store-a");

    expect(stillThere?.name).toBe("Isolated Reward");
  });

  it("replaces product associations on update (specific -> all clears them)", async () => {
    const reward = await createReward(
      { ...baseInput, name: "Flip Scope Reward", couponCode: "FLIPSCOPEREWARD", discountScope: "specific", productIds: [301] },
      "store-a",
    );

    const updated = await updateReward(
      reward.id,
      { ...baseInput, name: "Flip Scope Reward", couponCode: "FLIPSCOPEREWARD", discountScope: "all", productIds: [] },
      "store-a",
    );

    expect(updated?.productIds).toEqual([]);

    const fetched = await fetchRewardUncached(reward.id, "store-a");

    expect(fetched?.productIds).toEqual([]);
  });

  it("deleteReward cascades a manually-inserted huntry_eggs row for that reward", async () => {
    const reward = await createReward({ ...baseInput, name: "Egg Cascade Reward", couponCode: "EGGCASCADEREWARD" }, "store-a");

    // huntry_eggs.event_id is a real, enforced FK under node:sqlite's
    // DatabaseSync (it enables foreign key enforcement by default — unlike
    // what an existing comment in sponsors-api.ts assumes for sponsor_id),
    // so a real event row is required, not a placeholder id.
    const event = await createEvent(
      {
        name: "Egg Cascade Event",
        description: "",
        startsAt: null,
        endsAt: null,
        headerBannerUrl: null,
        markerRadiusMeters: 25,
        maxGrabCount: 1,
        eggClaimCapacity: 1,
        theme: DEFAULT_EVENT_THEME,
        isFeatured: false,
        featuredOrder: null,
      },
      "store-a",
    );

    const db = getHuntryDb() as DatabaseSync;

    db.prepare(
      "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), "store-a", reward.id, event.id, "Test Egg", 1.23, 4.56);

    const eggCountBefore = db
      .prepare("SELECT COUNT(*) as count FROM huntry_eggs WHERE reward_id = ?")
      .get(reward.id) as { count: number };

    expect(eggCountBefore.count).toBe(1);

    const deleted = await deleteReward(reward.id, "store-a");

    expect(deleted).toBe(true);

    const eggCountAfter = db
      .prepare("SELECT COUNT(*) as count FROM huntry_eggs WHERE reward_id = ?")
      .get(reward.id) as { count: number };

    expect(eggCountAfter.count).toBe(0);
  });

  it("deleteReward on a nonexistent id returns false", async () => {
    const deleted = await deleteReward(999999, "store-a");

    expect(deleted).toBe(false);
  });
});

describe("rewards-api (MOCK mode)", () => {
  it("creates/updates/deletes against MOCK_REWARDS", async () => {
    process.env.DATA_MODE = "MOCK";

    try {
      const created = await createReward(
        { ...baseInput, name: "Mock Reward", discountScope: "specific", productIds: [101, 102] },
        undefined,
      );

      expect(created.productIds).toEqual([101, 102]);
      expect(created.status).toBe("active");

      const fetched = await fetchReward(created.id, undefined);

      expect(fetched?.name).toBe("Mock Reward");

      const updated = await updateReward(
        created.id,
        { ...baseInput, name: "Mock Reward Updated", discountScope: "all", productIds: [] },
        undefined,
      );

      expect(updated?.name).toBe("Mock Reward Updated");

      const deleted = await deleteReward(created.id, undefined);

      expect(deleted).toBe(true);

      const afterDelete = await fetchReward(created.id, undefined);

      expect(afterDelete).toBeUndefined();
    } finally {
      process.env.DATA_MODE = "MULTITENANT";
    }
  });

  it("fetchBcProductsForPicker resolves against the registered mock handler", async () => {
    process.env.DATA_MODE = "MOCK";

    try {
      const products = await fetchBcProductsForPicker(undefined);

      expect(products.length).toBeGreaterThan(0);

      const filtered = await fetchBcProductsForPicker(undefined, "mug");

      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((product) => product.name.toLowerCase().includes("mug"))).toBe(true);
    } finally {
      process.env.DATA_MODE = "MULTITENANT";
    }
  });
});
