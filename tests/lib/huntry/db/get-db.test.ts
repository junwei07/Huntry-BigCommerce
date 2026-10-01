import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

const EXPECTED_TABLES = ["huntry_claims", "huntry_eggs", "huntry_events", "huntry_reward_products", "huntry_rewards", "huntry_sponsors"];

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-get-db-test-"));
  delete process.env.CREDENTIALS_STORE_DRIVER;
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
});

afterEach(() => {
  // See is-authorized-for-store.test.ts's afterEach for why this is
  // best-effort rather than asserted (DatabaseSync keeps its file handle
  // open, which can lock the temp dir on Windows).
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

describe("getHuntryDb (SQLite branch)", () => {
  it("creates all six Huntry tables on first open", () => {
    const db = getHuntryDb() as DatabaseSync;
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)("getHuntryDb (Postgres branch)", () => {
  it("returns a Pool when CREDENTIALS_STORE_DRIVER=POSTGRES", () => {
    process.env.CREDENTIALS_STORE_DRIVER = "POSTGRES";

    const db = getHuntryDb();

    expect(db).toHaveProperty("query");
  });
});
