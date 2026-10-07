import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAIM_RATE_LIMIT_MAX_CLAIMS,
  CLAIM_RATE_LIMIT_WINDOW_SECONDS,
  checkClaimRateLimit,
} from "@/lib/huntry/claims/claim-rate-limit";
import { addMockPlayerClaim } from "@/lib/huntry/claims/mock/mock-claims";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

const STORE = "store1";
const OTHER_STORE = "store2";
const NEW_EGG = "00000000-0000-4000-8000-0000000000ff";

let tempDir: string;

// Inserts a claim `agoSeconds` in the past (the DB's own clock decides the
// window, so expiry is tested with explicit past timestamps, not fake timers).
function insertClaim(
  db: DatabaseSync,
  options: { n: number; customer?: number; store?: string; agoSeconds?: number; forced?: boolean; iso?: boolean },
): void {
  const at = new Date(Date.now() - (options.agoSeconds ?? 0) * 1000);
  const claimedAt = options.iso ? at.toISOString() : at.toISOString().slice(0, 19).replace("T", " ");

  db.prepare(
    `INSERT INTO huntry_claims (store_hash, egg_id, reward_id, event_id, reward_name_snapshot, bc_customer_id, coupon_code, claimed_at, is_forced)
     VALUES (?, ?, 1, 1, 'Coffee', ?, ?, ?, ?)`,
  ).run(
    options.store ?? STORE,
    `00000000-0000-4000-8000-${String(options.n).padStart(12, "0")}`,
    options.customer ?? 42,
    `CODE${options.n}-${options.store ?? STORE}`,
    claimedAt,
    options.forced ? 1 : 0,
  );
}

function fill(db: DatabaseSync, count: number, options: Omit<Parameters<typeof insertClaim>[1], "n"> = {}) {
  for (let n = 1; n <= count; n++) {
    insertClaim(db, { ...options, n, agoSeconds: (options.agoSeconds ?? 0) + n });
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-claim-rate-limit-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
});

afterEach(() => {
  delete process.env.DATA_MODE;

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort — Windows file lock, see claims-api.test.ts.
  }
});

function freshDb(): DatabaseSync {
  const db = getHuntryDb() as DatabaseSync;

  // get-db.ts caches one connection per process, so rows outlive a test.
  db.exec("DELETE FROM huntry_claims");

  return db;
}

describe("checkClaimRateLimit (SQLite)", () => {
  it("allows a customer under the limit", async () => {
    const db = freshDb();

    fill(db, CLAIM_RATE_LIMIT_MAX_CLAIMS - 1);
    expect(await checkClaimRateLimit(STORE, 42, NEW_EGG)).toEqual({ limited: false });
  });

  it("limits a customer at the limit, retrying when the MAX-th newest claim expires", async () => {
    const db = freshDb();

    // Claims 1..10 seconds old; the 10th newest is 10 s old.
    fill(db, CLAIM_RATE_LIMIT_MAX_CLAIMS);

    const result = await checkClaimRateLimit(STORE, 42, NEW_EGG);

    expect(result.limited).toBe(true);

    if (result.limited) {
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(CLAIM_RATE_LIMIT_WINDOW_SECONDS - CLAIM_RATE_LIMIT_MAX_CLAIMS - 1);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(CLAIM_RATE_LIMIT_WINDOW_SECONDS - CLAIM_RATE_LIMIT_MAX_CLAIMS + 1);
    }
  });

  it("uses the MAX-th newest claim for the retry value when more than MAX are in the window", async () => {
    const db = freshDb();

    fill(db, CLAIM_RATE_LIMIT_MAX_CLAIMS + 3, { agoSeconds: 100 });

    const result = await checkClaimRateLimit(STORE, 42, NEW_EGG);

    // 10th newest is ~110 s old, so ~490 s to wait — not the oldest row's ~113 s age.
    expect(result.limited && result.retryAfterSeconds).toBeGreaterThanOrEqual(488);
    expect(result.limited && result.retryAfterSeconds).toBeLessThanOrEqual(492);
  });

  it("stops counting claims older than the window, in either timestamp format", async () => {
    const db = freshDb();

    for (let n = 1; n <= CLAIM_RATE_LIMIT_MAX_CLAIMS; n++) {
      insertClaim(db, { n, agoSeconds: CLAIM_RATE_LIMIT_WINDOW_SECONDS + 60, iso: n % 2 === 0 });
    }

    expect(await checkClaimRateLimit(STORE, 42, NEW_EGG)).toEqual({ limited: false });
  });

  it("counts ISO-formatted timestamps inside the window", async () => {
    const db = freshDb();

    for (let n = 1; n <= CLAIM_RATE_LIMIT_MAX_CLAIMS; n++) {
      insertClaim(db, { n, agoSeconds: n, iso: true });
    }

    expect((await checkClaimRateLimit(STORE, 42, NEW_EGG)).limited).toBe(true);
  });

  it("does not count other customers, other stores, or forced claims", async () => {
    const db = freshDb();

    fill(db, CLAIM_RATE_LIMIT_MAX_CLAIMS, { customer: 7 });
    // (egg_id, bc_customer_id) is globally UNIQUE, so each batch needs its own eggs.
    for (let n = 101; n < 101 + CLAIM_RATE_LIMIT_MAX_CLAIMS; n++) {
      insertClaim(db, { n, store: OTHER_STORE, agoSeconds: 5 });
      insertClaim(db, { n: n + 100, forced: true, agoSeconds: 5 });
    }

    expect(await checkClaimRateLimit(STORE, 42, NEW_EGG)).toEqual({ limited: false });
  });

  it("never limits a re-request of an egg the customer already holds", async () => {
    const db = freshDb();

    fill(db, CLAIM_RATE_LIMIT_MAX_CLAIMS);

    const owned = "00000000-0000-4000-8000-000000000001";

    expect(await checkClaimRateLimit(STORE, 42, owned)).toEqual({ limited: false });
    expect((await checkClaimRateLimit(STORE, 42, NEW_EGG)).limited).toBe(true);
  });
});

describe("checkClaimRateLimit (MOCK)", () => {
  beforeEach(() => {
    process.env.DATA_MODE = "MOCK";
  });

  it("limits after MAX mock claims and not before", async () => {
    // Customer ids are unique to this test: MOCK_CLAIMS is module state.
    const customer = 9001;

    for (let n = 0; n < CLAIM_RATE_LIMIT_MAX_CLAIMS - 1; n++) {
      addMockPlayerClaim({ eggId: `00000000-0000-4000-8000-9${String(n).padStart(11, "0")}`, bcCustomerId: customer, lat: 0, lng: 0 });
    }

    expect(await checkClaimRateLimit(undefined, customer, NEW_EGG)).toEqual({ limited: false });

    addMockPlayerClaim({ eggId: "00000000-0000-4000-8000-900000000099", bcCustomerId: customer, lat: 0, lng: 0 });

    const result = await checkClaimRateLimit(undefined, customer, NEW_EGG);

    expect(result.limited).toBe(true);
    expect(await checkClaimRateLimit(undefined, customer, "00000000-0000-4000-8000-900000000099")).toEqual({ limited: false });
  });
});
