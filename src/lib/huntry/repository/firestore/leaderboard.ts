import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { LeaderboardEntry } from "@/lib/huntry/claims/types";
import { readRequiredDate } from "@/lib/huntry/repository/firestore/convert";
import { storeCollection } from "@/lib/huntry/repository/firestore/paths";
import type { LeaderboardRepository } from "@/lib/huntry/repository/types";

export function createFirestoreLeaderboardRepository(getDb: () => Firestore = getFirestoreDb): LeaderboardRepository {
  return {
    // Aggregated in memory over the event's issued, non-forced claims (equality
    // filters only, so no composite index). Forced claims never rank; ties go to
    // whoever reached the count first (earliest last claim), then customer id.
    async getLeaderboard(storeHash, eventId, limit) {
      const snapshot = await storeCollection(getDb(), storeHash, "claims")
        .where("eventId", "==", eventId)
        .where("status", "==", "issued")
        .where("isForced", "==", false)
        .select("bcCustomerId", "claimedAt")
        .get();
      const byCustomer = new Map<number, LeaderboardEntry>();

      for (const doc of snapshot.docs) {
        const bcCustomerId = doc.get("bcCustomerId") as number;
        const claimedAt = readRequiredDate(doc.get("claimedAt"));
        const entry = byCustomer.get(bcCustomerId);

        if (!entry) {
          byCustomer.set(bcCustomerId, { bcCustomerId, claimCount: 1, lastClaimedAt: claimedAt });
        } else {
          entry.claimCount += 1;

          if (claimedAt > entry.lastClaimedAt) {
            entry.lastClaimedAt = claimedAt;
          }
        }
      }

      return [...byCustomer.values()]
        .sort(
          (a, b) =>
            b.claimCount - a.claimCount ||
            a.lastClaimedAt.getTime() - b.lastClaimedAt.getTime() ||
            a.bcCustomerId - b.bcCustomerId,
        )
        .slice(0, limit);
    },

    // Same filters as getLeaderboard, so the count always matches the ranking.
    async countPlayers(storeHash, eventId) {
      const snapshot = await storeCollection(getDb(), storeHash, "claims")
        .where("eventId", "==", eventId)
        .where("status", "==", "issued")
        .where("isForced", "==", false)
        .select("bcCustomerId")
        .get();

      return new Set(snapshot.docs.map((doc) => doc.get("bcCustomerId") as number)).size;
    },
  };
}
