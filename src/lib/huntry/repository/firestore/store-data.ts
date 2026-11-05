import type { Firestore } from "firebase-admin/firestore";
import { storeRef } from "@/lib/huntry/repository/firestore/paths";
import type { StoreDataRepository } from "@/lib/huntry/repository/types";

// Owned by the credentials driver (firestore-credentials-store.ts): its
// deleteStore transaction reads this to unlink users, so it must survive until
// then.
const CREDENTIALS_SUBCOLLECTION = "storeUsers";

// Deletes every Huntry subcollection under stores/{storeHash}. Enumerates at
// runtime with listCollections() because StoreCollection (paths.ts) is only a
// type, and so a collection added later is covered without touching this file.
export function createFirestoreStoreDataRepository(getDb: () => Firestore): StoreDataRepository {
  return {
    async deleteAllStoreData(storeHash) {
      const db = getDb();
      const collections = await storeRef(db, storeHash).listCollections();

      for (const collection of collections) {
        if (collection.id !== CREDENTIALS_SUBCOLLECTION) {
          await db.recursiveDelete(collection);
        }
      }
    },
  };
}
