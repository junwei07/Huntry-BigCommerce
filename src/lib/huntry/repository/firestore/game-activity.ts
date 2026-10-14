import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { toClaim } from "@/lib/huntry/repository/firestore/claim-docs";
import { storeCollection } from "@/lib/huntry/repository/firestore/paths";
import type { GameActivityRepository } from "@/lib/huntry/repository/types";

export function createFirestoreGameActivityRepository(getDb: () => Firestore = getFirestoreDb): GameActivityRepository {
  return {
    // Newest first, forced claims included, pending reservations excluded. Needs
    // the composite index (eventId, status, claimedAt desc) in firestore.indexes.json.
    async listRecentClaims(storeHash, eventId, limit) {
      const snapshot = await storeCollection(getDb(), storeHash, "claims")
        .where("eventId", "==", eventId)
        .where("status", "==", "issued")
        .orderBy("claimedAt", "desc")
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => toClaim(doc.data()));
    },
  };
}
