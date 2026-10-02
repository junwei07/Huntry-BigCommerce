import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import {
  computeEventStatus,
  createEvent,
  deleteEvent,
  fetchEvent,
  fetchEventUncached,
  fetchEvents,
  updateEvent,
} from "@/lib/huntry/events/events-api";
import { CreateEventInput, DEFAULT_EVENT_THEME, EVENT_THEME_PRESETS } from "@/lib/huntry/events/types";
import { createReward } from "@/lib/huntry/rewards/rewards-api";
import { CreateRewardInput } from "@/lib/huntry/rewards/types";

describe("computeEventStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("returns 'not-scheduled' when there is no startsAt", () => {
    expect(computeEventStatus(null, null, now)).toBe("not-scheduled");
  });

  it("returns 'upcoming' when now is before startsAt", () => {
    const startsAt = new Date("2026-06-20T00:00:00Z");

    expect(computeEventStatus(startsAt, null, now)).toBe("upcoming");
  });

  it("returns 'ended' when endsAt is set and now is at or after it", () => {
    const startsAt = new Date("2026-06-01T00:00:00Z");
    const endsAt = new Date("2026-06-10T00:00:00Z");

    expect(computeEventStatus(startsAt, endsAt, now)).toBe("ended");
  });

  it("returns 'live' when startsAt has passed and endsAt hasn't (or is unset)", () => {
    const startsAt = new Date("2026-06-01T00:00:00Z");

    expect(computeEventStatus(startsAt, null, now)).toBe("live");
    expect(computeEventStatus(startsAt, new Date("2026-06-30T00:00:00Z"), now)).toBe("live");
  });
});

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-events-api-test-"));
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

const baseInput: CreateEventInput = {
  name: "Test Event",
  description: "desc",
  startsAt: null,
  endsAt: null,
  headerBannerUrl: null,
  markerRadiusMeters: 25,
  maxGrabCount: 1,
  eggClaimCapacity: 1,
  theme: DEFAULT_EVENT_THEME,
  isFeatured: false,
  featuredOrder: null,
};

describe("events-api (SQLite)", () => {
  it("creates an event scoped to a store, deriving a slug and round-tripping theme/isFeatured", async () => {
    const event = await createEvent(
      { ...baseInput, name: "Autumn Hunt", theme: { ...DEFAULT_EVENT_THEME, colors: EVENT_THEME_PRESETS[1] }, isFeatured: true },
      "store-a",
    );

    expect(event.storeHash).toBe("store-a");
    expect(event.slug).toBe("autumn-hunt");
    expect(event.theme.colors).toEqual(EVENT_THEME_PRESETS[1]);
    expect(event.isFeatured).toBe(true);
    expect(event.status).toBe("not-scheduled");
  });

  it("dedupes the slug when two events in the same store share a name", async () => {
    const first = await createEvent({ ...baseInput, name: "Duplicate Name Hunt" }, "store-a");
    const second = await createEvent({ ...baseInput, name: "Duplicate Name Hunt" }, "store-a");

    expect(first.slug).toBe("duplicate-name-hunt");
    expect(second.slug).toBe("duplicate-name-hunt-2");
  });

  it("enforces store isolation on update/delete", async () => {
    const event = await createEvent({ ...baseInput, name: "Isolated Hunt" }, "store-a");

    const updatedWrongStore = await updateEvent(event.id, { ...baseInput, name: "Hacked" }, "store-b");

    expect(updatedWrongStore).toBeUndefined();

    const deletedWrongStore = await deleteEvent(event.id, "store-b");

    expect(deletedWrongStore).toBe(false);

    const stillThere = await fetchEventUncached(event.id, "store-a");

    expect(stillThere?.name).toBe("Isolated Hunt");
  });

  it("preserves slug/createdAt while updating editable fields", async () => {
    const event = await createEvent({ ...baseInput, name: "Preserve Slug Hunt" }, "store-a");

    const updated = await updateEvent(event.id, { ...baseInput, name: "Renamed Hunt", description: "new desc" }, "store-a");

    expect(updated?.name).toBe("Renamed Hunt");
    expect(updated?.description).toBe("new desc");
    expect(updated?.slug).toBe(event.slug);
    expect(updated?.createdAt).toEqual(event.createdAt);
  });

  it("deleteEvent cascades a manually-inserted huntry_eggs row for that event", async () => {
    const event = await createEvent({ ...baseInput, name: "Egg Cascade Hunt" }, "store-a");

    // huntry_eggs.reward_id is a real, enforced, non-nullable FK under
    // node:sqlite's DatabaseSync (confirmed while building
    // rewards-api.test.ts), so a real reward row is required too, not a
    // placeholder id.
    const rewardInput: CreateRewardInput = {
      name: "Egg Cascade Reward",
      description: "",
      sponsorId: null,
      couponCode: "EGGCASCADEHUNTREWARD",
      eggCapacity: 5,
      rewardStartsAt: null,
      rewardExpiresAt: null,
      discountType: "percent",
      discountValue: 10,
      discountScope: "all",
      productIds: [],
    };
    const reward = await createReward(rewardInput, "store-a");

    const db = getHuntryDb() as DatabaseSync;

    db.prepare(
      "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), "store-a", reward.id, event.id, "Test Egg", 1.23, 4.56);

    const eggCountBefore = db
      .prepare("SELECT COUNT(*) as count FROM huntry_eggs WHERE event_id = ?")
      .get(event.id) as { count: number };

    expect(eggCountBefore.count).toBe(1);

    const deleted = await deleteEvent(event.id, "store-a");

    expect(deleted).toBe(true);

    const eggCountAfter = db
      .prepare("SELECT COUNT(*) as count FROM huntry_eggs WHERE event_id = ?")
      .get(event.id) as { count: number };

    expect(eggCountAfter.count).toBe(0);
  });

  it("deleteEvent on a nonexistent id returns false", async () => {
    const deleted = await deleteEvent(999999, "store-a");

    expect(deleted).toBe(false);
  });
});

describe("events-api (MOCK mode)", () => {
  it("creates/updates/deletes against MOCK_EVENTS, including MOCK's own slug dedup", async () => {
    process.env.DATA_MODE = "MOCK";

    try {
      const created = await createEvent({ ...baseInput, name: "Spring Scavenger Hunt" }, undefined);

      // "Spring Scavenger Hunt" -> "spring-scavenger-hunt" already exists in
      // mock-events.ts's fixtures (id 1) — MOCK mode's own dedup loop (
      // independent of the DB-mode isUniqueSlugConstraintError retry path)
      // should produce the "-2" suffix.
      expect(created.slug).toBe("spring-scavenger-hunt-2");

      const fetched = await fetchEvent(created.id, undefined);

      expect(fetched?.name).toBe("Spring Scavenger Hunt");

      const updated = await updateEvent(created.id, { ...baseInput, name: "Spring Scavenger Hunt Updated" }, undefined);

      expect(updated?.name).toBe("Spring Scavenger Hunt Updated");
      expect(updated?.slug).toBe(created.slug);

      const deleted = await deleteEvent(created.id, undefined);

      expect(deleted).toBe(true);

      const afterDelete = await fetchEvent(created.id, undefined);

      expect(afterDelete).toBeUndefined();
    } finally {
      process.env.DATA_MODE = "MULTITENANT";
    }
  });

  it("sorts an event with no startsAt last regardless of direction", async () => {
    process.env.DATA_MODE = "MOCK";

    try {
      const ascending = await fetchEvents({ direction: "ASC" }, undefined);
      const descending = await fetchEvents({ direction: "DESC" }, undefined);

      // mock-events.ts's id 1 ("Spring Scavenger Hunt") has startsAt: null.
      expect(ascending[ascending.length - 1].id).toBe(1);
      expect(descending[descending.length - 1].id).toBe(1);
    } finally {
      process.env.DATA_MODE = "MULTITENANT";
    }
  });
});
