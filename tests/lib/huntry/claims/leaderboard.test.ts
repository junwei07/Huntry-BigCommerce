import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createForcedClaim } from "@/lib/huntry/claims/claims-api";
import { fetchGameActivity } from "@/lib/huntry/claims/game-activity";
import { fetchLeaderboard, fetchPlayerCount } from "@/lib/huntry/claims/leaderboard";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

let tempDir: string;

function claim(eggId: string, bcCustomerId: number, eventId = 1) {
  return {
    eggId,
    rewardId: 1,
    eventId,
    rewardNameSnapshot: "Free Coffee",
    bcCustomerId,
    couponCode: `C-${eggId}-${bcCustomerId}`,
    forcedByUserId: 7,
  };
}

// createForcedClaim always sets is_forced, so player claims are flipped after.
async function seed(eggId: string, bcCustomerId: number, options: { forced: boolean; eventId?: number }) {
  await createForcedClaim(claim(eggId, bcCustomerId, options.eventId), "store1");

  if (!options.forced) {
    (getHuntryDb() as import("node:sqlite").DatabaseSync)
      .prepare("UPDATE huntry_claims SET is_forced = 0, forced_by_user_id = NULL WHERE egg_id = ? AND bc_customer_id = ?")
      .run(eggId, bcCustomerId);
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-leaderboard-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");

  // The DB handle is a process-wide singleton, so rows would leak across tests.
  (getHuntryDb() as import("node:sqlite").DatabaseSync).exec("DELETE FROM huntry_claims");
});

afterEach(() => {
  delete process.env.DATA_MODE;

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored (Windows file lock).
  }
});

describe("fetchLeaderboard (SQLite)", () => {
  it("excludes forced claims, ranks by count and scopes to the event", async () => {
    await seed("egg-a", 1, { forced: false });
    await seed("egg-b", 1, { forced: false });
    await seed("egg-a", 2, { forced: false });
    await seed("egg-a", 3, { forced: true });
    await seed("egg-b", 3, { forced: true });
    await seed("egg-c", 3, { forced: true });
    await seed("egg-z", 2, { forced: false, eventId: 2 });

    const rows = await fetchLeaderboard(1, "store1");

    expect(rows.map((row) => [row.bcCustomerId, row.claimCount])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(rows[0].lastClaimedAt).toBeInstanceOf(Date);
  });
});

describe("fetchPlayerCount (SQLite)", () => {
  it("counts distinct claimants in the event (forced included, as the player cap does), beyond the leaderboard limit", async () => {
    await seed("egg-a", 1, { forced: false });
    await seed("egg-b", 1, { forced: false });
    await seed("egg-a", 2, { forced: false });
    await seed("egg-a", 3, { forced: true });
    await seed("egg-z", 4, { forced: false, eventId: 2 });
    await seed("egg-y", 5, { forced: false });

    expect(await fetchPlayerCount(1, "store1")).toBe(4);
    expect(await fetchLeaderboard(1, "store1", 1)).toHaveLength(1);
    expect(await fetchPlayerCount(99, "store1")).toBe(0);
  });
});

describe("fetchGameActivity (SQLite)", () => {
  it("includes forced claims with their audit columns", async () => {
    await seed("egg-a", 1, { forced: false });
    await seed("egg-b", 3, { forced: true });

    const rows = await fetchGameActivity(1, "store1");

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.bcCustomerId === 3)).toMatchObject({ isForced: true, forcedByUserId: 7 });
    expect(rows.find((row) => row.bcCustomerId === 1)).toMatchObject({ isForced: false, forcedByUserId: null });
  });
});
