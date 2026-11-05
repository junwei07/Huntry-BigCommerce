import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { StoreDataRepository } from "@/lib/huntry/repository/types";

// Child tables first: huntry_reward_products has no store_hash of its own, and
// huntry_eggs / huntry_rewards reference each other and the sponsors table, so
// the order below satisfies every in-database foreign key.
const DELETE_STATEMENTS = [
  "DELETE FROM huntry_claims WHERE store_hash = ?",
  "DELETE FROM huntry_eggs WHERE store_hash = ?",
  "DELETE FROM huntry_reward_products WHERE reward_id IN (SELECT id FROM huntry_rewards WHERE store_hash = ?)",
  "DELETE FROM huntry_rewards WHERE store_hash = ?",
  "DELETE FROM huntry_events WHERE store_hash = ?",
  "DELETE FROM huntry_sponsors WHERE store_hash = ?",
  "DELETE FROM huntry_storefront_settings WHERE store_hash = ?",
];

function toPostgres(sql: string): string {
  return sql.replace("= ?", "= $1");
}

// SQLite has no cross-file FK to the credentials DB, so its rows would outlive
// an uninstall without this. Postgres cascades from `stores` as well, but doing
// the same deletes explicitly keeps the method self-contained and idempotent.
export const sqlStoreDataRepository: StoreDataRepository = {
  async deleteAllStoreData(storeHash) {
    const db = getHuntryDb();

    if (db instanceof DatabaseSync) {
      db.exec("BEGIN");

      try {
        for (const sql of DELETE_STATEMENTS) {
          db.prepare(sql).run(storeHash);
        }

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");

        throw error;
      }

      return;
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      for (const sql of DELETE_STATEMENTS) {
        await client.query(toPostgres(sql), [storeHash]);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");

      throw error;
    } finally {
      client.release();
    }
  },
};
