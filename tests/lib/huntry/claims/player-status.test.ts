import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForcedClaim } from "@/lib/huntry/claims/claims-api";
import { getPlayerStatus } from "@/lib/huntry/claims/player-status";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

// Independent of the real cap so the test doesn't track its value.
vi.mock("@/lib/huntry/claims/limits", () => ({ MAX_PLAYERS_PER_EVENT: 2 }));

let tempDir: string;

function seed(eggId: string, bcCustomerId: number, eventId = 1) {
  return createForcedClaim(
    {
      eggId,
      rewardId: 1,
      eventId,
      rewardNameSnapshot: "Free Coffee",
      bcCustomerId,
      couponCode: `C-${eggId}-${bcCustomerId}`,
      forcedByUserId: 7,
    },
    "store1",
  );
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-player-status-test-"));
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

describe("getPlayerStatus (SQLite)", () => {
  it("is open to a new customer below the cap", async () => {
    await seed("egg-a", 1);

    expect(await getPlayerStatus("store1", 1, 99)).toEqual({ full: false });
  });

  it("is full for a new customer once the event has reached the cap", async () => {
    await seed("egg-a", 1);
    await seed("egg-a", 2);

    expect(await getPlayerStatus("store1", 1, 99)).toEqual({ full: true });
  });

  it("never blocks a customer who already holds a claim in the event", async () => {
    await seed("egg-a", 1);
    await seed("egg-a", 2);

    expect(await getPlayerStatus("store1", 1, 2)).toEqual({ full: false });
  });

  it("only counts the requested event", async () => {
    await seed("egg-a", 1);
    await seed("egg-a", 2);
    // Customer 99 only plays in another event, which doesn't make them a player of event 1.
    await seed("egg-z", 99, 2);

    expect(await getPlayerStatus("store1", 1, 99)).toEqual({ full: true });
    expect(await getPlayerStatus("store1", 2, 3)).toEqual({ full: false });
  });
});
