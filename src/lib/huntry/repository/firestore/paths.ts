import type { CollectionReference, DocumentReference, Firestore } from "firebase-admin/firestore";
import { assertValidStoreHash } from "@/lib/firebase/store-hash";

// Huntry's own data lives under the same `stores/{storeHash}` document as the
// credentials (credentials-store/firestore-driver), one subcollection per concept:
//   events, sponsors, rewards, eggs, claims, customers, counters, settings,
//   slugs, couponCodes
// Every accessor validates the store hash first, so a URL segment can never
// become a nested path or a reserved id.
export const STORES = "stores";

export type StoreCollection =
  | "events"
  | "sponsors"
  | "rewards"
  | "eggs"
  | "claims"
  | "customers"
  | "counters"
  | "settings"
  | "slugs"
  | "couponCodes";

export function storeRef(db: Firestore, storeHash: string): DocumentReference {
  assertValidStoreHash(storeHash);

  return db.collection(STORES).doc(storeHash);
}

export function storeCollection(db: Firestore, storeHash: string, name: StoreCollection): CollectionReference {
  return storeRef(db, storeHash).collection(name);
}

export function storeDoc(db: Firestore, storeHash: string, name: StoreCollection, id: string | number): DocumentReference {
  return storeCollection(db, storeHash, name).doc(String(id));
}
