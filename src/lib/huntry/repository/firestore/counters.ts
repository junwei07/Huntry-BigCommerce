import type { Firestore, Transaction } from "firebase-admin/firestore";
import { storeDoc } from "@/lib/huntry/repository/firestore/paths";

// Events, sponsors and rewards keep numeric ids (URLs, cache tags, BigCommerce
// references). Firestore has no sequence, so each store has one allocator doc,
// `counters/ids`, holding the last id handed out per kind. Ids are therefore
// unique per store, not globally: every lookup stays scoped by store hash.
//
// Claims never use this (a counter written on every claim would cap a store at
// about one claim per second); they use the string doc id.
export type NumericIdKind = "events" | "sponsors" | "rewards";

export interface ReservedId {
  id: number;
  // Writes the new high-water mark. Call it only after every read in the
  // transaction is done: Firestore requires reads before writes.
  commit: () => void;
}

export async function reserveNumericId(
  db: Firestore,
  tx: Transaction,
  storeHash: string,
  kind: NumericIdKind,
): Promise<ReservedId> {
  const ref = storeDoc(db, storeHash, "counters", "ids");
  const snapshot = await tx.get(ref);
  const last = snapshot.get(kind);
  const id = (typeof last === "number" && Number.isSafeInteger(last) ? last : 0) + 1;

  return { id, commit: () => tx.set(ref, { [kind]: id }, { merge: true }) };
}
