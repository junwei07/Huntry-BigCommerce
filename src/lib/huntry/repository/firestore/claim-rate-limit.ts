import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { claimRef } from "@/lib/huntry/repository/firestore/claim-docs";
import { readRequiredDate } from "@/lib/huntry/repository/firestore/convert";
import { storeCollection } from "@/lib/huntry/repository/firestore/paths";
import type { ClaimRateLimitRepository } from "@/lib/huntry/repository/types";

export function createFirestoreClaimRateLimitRepository(getDb: () => Firestore = getFirestoreDb): ClaimRateLimitRepository {
  return {
    // A customer who already holds (or is reserving) this egg is never limited, so
    // a re-request still reaches the claim transaction and gets their existing code
    // back as a duplicate, or `claim_in_progress` while it is pending. Any status
    // counts, which is why this reads the claim doc by id.
    async hasClaimedEgg(storeHash, eggId, customerId) {
      return (await claimRef(getDb(), storeHash, eggId, customerId).get()).exists;
    },

    // Ages come from the app clock (the DB-clock rule applies to the SQL path
    // only): claimedAt is stamped by the same clock, so skew cannot shift them.
    // Needs the composite index (bcCustomerId, status, isForced, claimedAt desc).
    async listRecentClaimAges(storeHash, customerId, windowSeconds, maxClaims) {
      const now = Date.now();
      const windowStart = new Date(now - windowSeconds * 1000);
      const snapshot = await storeCollection(getDb(), storeHash, "claims")
        .where("bcCustomerId", "==", customerId)
        .where("status", "==", "issued")
        .where("isForced", "==", false)
        .where("claimedAt", ">", windowStart)
        .orderBy("claimedAt", "desc")
        .limit(maxClaims)
        .get();

      return snapshot.docs.map((doc) => (now - readRequiredDate(doc.get("claimedAt")).getTime()) / 1000);
    },
  };
}
