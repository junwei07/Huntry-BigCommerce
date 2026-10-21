import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { EggClaimCount } from "@/lib/huntry/claims/types";
import {
  claimDocData,
  claimRef,
  customerRef,
  EGG_COUNTER_PREFIX,
  eggCounterRef,
  eventPlayersCounterRef,
  readCount,
  readCustomer,
  rewardCounterRef,
  toClaim,
} from "@/lib/huntry/repository/firestore/claim-docs";
import { compareStrings } from "@/lib/huntry/repository/firestore/convert";
import { isAlreadyExistsError } from "@/lib/huntry/repository/firestore/errors";
import { storeCollection } from "@/lib/huntry/repository/firestore/paths";
import type { ClaimRecordsRepository } from "@/lib/huntry/repository/types";

export function createFirestoreClaimRecordsRepository(getDb: () => Firestore = getFirestoreDb): ClaimRecordsRepository {
  async function eggCounters(storeHash: string, eventId: number) {
    const snapshot = await storeCollection(getDb(), storeHash, "counters").where("eventId", "==", eventId).get();

    return snapshot.docs
      .filter((doc) => doc.id.startsWith(EGG_COUNTER_PREFIX))
      .map((doc) => ({ eggId: doc.id.slice(EGG_COUNTER_PREFIX.length), count: readCount(doc.data()), forced: readCount(doc.data(), "forced") }));
  }

  return {
    // Inserts directly as forced and runs none of the player-claim checks. Counts
    // toward egg and reward capacity and the customer's per-event total, and
    // writes `lastClaimAt` with no position (so the speed check is skipped for
    // the next claim), exactly as the SQL path's last-claim lookup behaves.
    async createForcedClaim(storeHash, input) {
      const db = getDb();
      const ref = claimRef(db, storeHash, input.eggId, input.bcCustomerId);
      const eggCounter = eggCounterRef(db, storeHash, input.eggId);
      const rewardCounter = rewardCounterRef(db, storeHash, input.rewardId);
      const customer = customerRef(db, storeHash, input.bcCustomerId);
      const playersCounter = eventPlayersCounterRef(db, storeHash, input.eventId);

      try {
        return await db.runTransaction(async (tx) => {
          const [claimSnapshot, eggSnapshot, rewardSnapshot, customerSnapshot, playersSnapshot] = await tx.getAll(
            ref,
            eggCounter,
            rewardCounter,
            customer,
            playersCounter,
          );

          // A pending reservation on the same egg and customer also blocks it.
          if (claimSnapshot.exists) {
            return { status: "duplicate" as const };
          }

          const now = new Date();
          const data = claimDocData({
            storeHash,
            eggId: input.eggId,
            rewardId: input.rewardId,
            eventId: input.eventId,
            rewardNameSnapshot: input.rewardNameSnapshot,
            bcCustomerId: input.bcCustomerId,
            couponCode: input.couponCode,
            claimedAt: now,
            isForced: true,
            forcedByUserId: input.forcedByUserId,
            status: "issued",
          });
          const state = readCustomer(customerSnapshot.data());
          const eventKey = String(input.eventId);

          tx.create(ref, data);
          tx.set(
            eggCounter,
            {
              eventId: input.eventId,
              count: readCount(eggSnapshot.data()) + 1,
              forced: readCount(eggSnapshot.data(), "forced") + 1,
            },
            { merge: true },
          );
          tx.set(rewardCounter, { count: readCount(rewardSnapshot.data()) + 1 }, { merge: true });

          // A forced claim makes the customer a player too (never refused by the cap).
          if ((state.eventCounts[eventKey] ?? 0) === 0) {
            tx.set(playersCounter, { count: readCount(playersSnapshot.data()) + 1 }, { merge: true });
          }

          tx.set(customer, {
            lastClaimAt: now,
            lastLat: null,
            lastLng: null,
            eventCounts: { ...state.eventCounts, [eventKey]: (state.eventCounts[eventKey] ?? 0) + 1 },
          });

          return { status: "created" as const, claim: toClaim(data) };
        });
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          return { status: "duplicate" };
        }

        throw error;
      }
    },

    // Forced claims count toward capacity, and so do reserved (pending) ones.
    async listFullEggIds(storeHash, eventId, capacity) {
      const counters = await eggCounters(storeHash, eventId);

      return new Set(counters.filter((counter) => counter.count >= capacity && counter.count > 0).map((counter) => counter.eggId));
    },

    // Newest first (claimedAt, then id), issued claims only.
    async listClaimsForCustomer(storeHash, bcCustomerId) {
      const snapshot = await storeCollection(getDb(), storeHash, "claims")
        .where("bcCustomerId", "==", bcCustomerId)
        .where("status", "==", "issued")
        .get();
      const claims = snapshot.docs.map((doc) => toClaim(doc.data()));

      claims.sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime() || compareStrings(String(b.id), String(a.id)));

      return claims;
    },

    async getEggClaimCounts(storeHash, eventId) {
      const counts = new Map<string, EggClaimCount>();

      for (const counter of await eggCounters(storeHash, eventId)) {
        if (counter.count > 0) {
          counts.set(counter.eggId, { count: counter.count, forced: counter.forced });
        }
      }

      return counts;
    },
  };
}
