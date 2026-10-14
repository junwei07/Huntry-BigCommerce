import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { RedemptionCandidate } from "@/lib/huntry/claims/redemption";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { RedemptionRepository } from "@/lib/huntry/repository/types";

// Firestore's `in` operator takes at most 30 values.
const IN_LIMIT = 30;

export function createFirestoreRedemptionRepository(getDb: () => Firestore = getFirestoreDb): RedemptionRepository {
  return {
    // Scoped to the store's own `claims` subcollection (never a collection-group
    // query), so a code from another store's order can never touch this store.
    // Matching is on `couponCodeNormalized` (trimmed + uppercased on write), because
    // BigCommerce echoes the code as the shopper typed it.
    async findClaimsByNormalizedCouponCodes(storeHash, normalizedCodes) {
      const claims = storeCollection(getDb(), storeHash, "claims");
      const found: RedemptionCandidate[] = [];

      for (let start = 0; start < normalizedCodes.length; start += IN_LIMIT) {
        const snapshot = await claims
          .where("couponCodeNormalized", "in", normalizedCodes.slice(start, start + IN_LIMIT))
          .where("status", "==", "issued")
          .get();

        for (const doc of snapshot.docs) {
          found.push({
            id: doc.id,
            eventId: doc.get("eventId"),
            bcCustomerId: doc.get("bcCustomerId"),
            couponCode: doc.get("couponCode"),
            redemptionStatus: doc.get("redemptionStatus"),
          });
        }
      }

      return found;
    },

    // Compare-and-set per claim: only a claim still `unredeemed` is written, so a
    // redelivered webhook can never flip an already-decided claim.
    async markRedemptions(storeHash, orderId, updates) {
      const db = getDb();
      let changed = 0;

      for (const update of updates) {
        const ref = storeDoc(db, storeHash, "claims", String(update.claimId));
        const didChange = await db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);

          if (!snapshot.exists || snapshot.get("status") !== "issued" || snapshot.get("redemptionStatus") !== "unredeemed") {
            return false;
          }

          tx.update(ref, { redemptionStatus: update.status, orderId });

          return true;
        });

        if (didChange) {
          changed += 1;
        }
      }

      return changed;
    },
  };
}
