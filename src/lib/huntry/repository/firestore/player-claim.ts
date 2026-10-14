import { randomUUID } from "node:crypto";
import { DocumentData, FieldValue, Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { ClaimContext } from "@/lib/huntry/claims/player-claim";
import { normalizeCouponCode } from "@/lib/huntry/claims/coupon-code";
import type { CreatePlayerClaimResult } from "@/lib/huntry/claims/types";
import {
  claimDocData,
  claimRef,
  customerRef,
  CustomerState,
  eggCounterRef,
  readCount,
  readCustomer,
  rewardCounterRef,
  toClaim,
} from "@/lib/huntry/repository/firestore/claim-docs";
import { readDate } from "@/lib/huntry/repository/firestore/convert";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { PlayerClaimHooks, PlayerClaimRepository } from "@/lib/huntry/repository/types";

// The atomic, capacity-validated player claim on Firestore (replaces
// pg_advisory_xact_lock + FOR UPDATE in sql/player-claim.ts). Every decision
// still lives in the facade's evaluateClaim, passed in as a hook.
//
// A Firestore transaction retries, and issuing the per-claim coupon code is an
// external call that must not, so a claim is three steps:
//   1. reserve   (transaction) evaluate, then create a `pending` claim doc, bump
//                the egg/reward counters and update the customer doc
//   2. issue     the hook, outside any transaction
//   3. finalize  (transaction) flip the claim to `issued` with its code; on any
//                failure, release the reservation instead
//
// Capacity is serialized on the counter docs, not on count() queries (a count
// inside a transaction does not reliably block a concurrent insert), and the
// per-customer doc serializes the cooldown, speed and max-grab checks across eggs.

// A reservation older than this belongs to a crashed or timed-out request. The
// code-issue call times out after 10s (claims/player-claim.ts), so this is
// generous. Releasing it is safe even if it had already issued a code: an unused
// single-use code nobody was shown is harmless (rewards/claim-codes.ts).
export const PENDING_TTL_MS = 60_000;

const EGG_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ReserveOutcome =
  | { kind: "done"; result: CreatePlayerClaimResult; rewardId?: number }
  | { kind: "reserved"; reservationId: string; reward: ClaimContext["reward"]; eventId: number; rewardId: number };

interface Counts {
  egg: number;
  reward: number;
}

// Undoes one reservation against the state read in the same transaction: both
// counters and the customer's per-event total go down, and the customer's last
// position/time is restored only when nothing has claimed since (otherwise a
// failed code issue would leave the customer in a 3s cooldown).
function undoReservation(pending: DocumentData, customer: CustomerState, counts: Counts) {
  const previous = (pending.previousCustomer ?? {}) as DocumentData;
  const reservedAt = readDate(pending.reservedAt);
  const untouched = reservedAt !== null && customer.lastClaimAt?.getTime() === reservedAt.getTime();
  const eventKey = String(pending.eventId);
  const eventCounts = { ...customer.eventCounts, [eventKey]: Math.max((customer.eventCounts[eventKey] ?? 0) - 1, 0) };

  return {
    counts: { egg: Math.max(counts.egg - 1, 0), reward: Math.max(counts.reward - 1, 0) },
    customer: {
      lastClaimAt: untouched ? readDate(previous.lastClaimAt) : customer.lastClaimAt,
      lastLat: untouched ? (previous.lastLat ?? null) : customer.lastLat,
      lastLng: untouched ? (previous.lastLng ?? null) : customer.lastLng,
      eventCounts,
    } satisfies CustomerState,
  };
}

function isExpired(pending: DocumentData, now: Date): boolean {
  const reservedAt = readDate(pending.reservedAt);

  return reservedAt === null || now.getTime() - reservedAt.getTime() > PENDING_TTL_MS;
}

export function createFirestorePlayerClaimRepository(getDb: () => Firestore = getFirestoreDb): PlayerClaimRepository {
  async function reserve(
    db: Firestore,
    storeHash: string,
    input: { eggId: string; bcCustomerId: number; lat: number; lng: number },
    hooks: PlayerClaimHooks,
  ): Promise<ReserveOutcome> {
    return db.runTransaction(async (tx): Promise<ReserveOutcome> => {
      const now = new Date();
      const eggSnapshot = await tx.get(storeDoc(db, storeHash, "eggs", input.eggId));

      if (!eggSnapshot.exists) {
        return { kind: "done", result: { status: "egg_not_found" } };
      }

      const egg = eggSnapshot.data() as DocumentData;
      const claim = claimRef(db, storeHash, input.eggId, input.bcCustomerId);
      const customerDoc = customerRef(db, storeHash, input.bcCustomerId);
      const eggCounter = eggCounterRef(db, storeHash, input.eggId);
      const rewardCounter = rewardCounterRef(db, storeHash, egg.rewardId);
      const [eventSnapshot, rewardSnapshot, customerSnapshot, claimSnapshot, eggCounterSnapshot, rewardCounterSnapshot] =
        await tx.getAll(
          storeDoc(db, storeHash, "events", egg.eventId),
          storeDoc(db, storeHash, "rewards", egg.rewardId),
          customerDoc,
          claim,
          eggCounter,
          rewardCounter,
        );
      const placed = await tx.get(storeCollection(db, storeHash, "eggs").where("rewardId", "==", egg.rewardId));
      const placedEventIds = [...new Set(placed.docs.map((doc) => doc.get("eventId") as number))];
      const placedEvents = placedEventIds.length
        ? await tx.getAll(...placedEventIds.map((eventId) => storeDoc(db, storeHash, "events", eventId)))
        : [];

      // Everything below is computed from what was read; writes come last.
      if (!eventSnapshot.exists || !rewardSnapshot.exists) {
        return { kind: "done", result: { status: "reward_unavailable" }, rewardId: egg.rewardId };
      }

      let customer = readCustomer(customerSnapshot.data());
      let counts: Counts = { egg: readCount(eggCounterSnapshot.data()), reward: readCount(rewardCounterSnapshot.data()) };
      const existing = claimSnapshot.exists ? (claimSnapshot.data() as DocumentData) : undefined;
      let takeover = false;

      if (existing?.status === "pending") {
        if (!isExpired(existing, now)) {
          return { kind: "done", result: { status: "claim_in_progress" }, rewardId: egg.rewardId };
        }

        // A crashed earlier attempt by this same customer on this same egg: release
        // it in memory and carry on, replacing the doc in this transaction.
        const released = undoReservation(existing, customer, counts);

        customer = released.customer;
        counts = released.counts;
        takeover = true;
      }

      const event = eventSnapshot.data() as DocumentData;
      const reward = rewardSnapshot.data() as DocumentData;
      const eventKey = String(egg.eventId);
      const context: ClaimContext = {
        egg: { lat: egg.lat, lng: egg.lng },
        event: {
          startsAt: readDate(event.startsAt),
          endsAt: readDate(event.endsAt),
          markerRadiusMeters: Number(event.markerRadiusMeters),
          maxGrabCount: Number(event.maxGrabCount),
          eggClaimCapacity: Number(event.eggClaimCapacity),
        },
        reward: {
          id: egg.rewardId,
          name: String(reward.name),
          status: String(reward.status),
          couponCode: reward.couponCode ?? null,
          bcPromotionId: reward.bcPromotionId ?? null,
          eggCapacity: Number(reward.eggCapacity),
          startsAt: readDate(reward.rewardStartsAt),
          expiresAt: readDate(reward.rewardExpiresAt),
          placedEggClaimCapacities: placed.docs.map((doc) => {
            const parent = placedEvents[placedEventIds.indexOf(doc.get("eventId") as number)];

            return parent?.exists ? (parent.get("eggClaimCapacity") as number) : null;
          }),
        },
        counts: { egg: counts.egg, reward: counts.reward, customerInEvent: customer.eventCounts[eventKey] ?? 0 },
        existingCouponCode: existing?.status === "issued" ? (existing.couponCode ?? null) : null,
        lastClaim: customer.lastClaimAt
          ? {
              lat: customer.lastLat,
              lng: customer.lastLng,
              elapsedSeconds: Math.max((now.getTime() - customer.lastClaimAt.getTime()) / 1000, 0.001),
            }
          : null,
      };
      const evaluation = hooks.evaluate(context);

      if (!("ok" in evaluation)) {
        return { kind: "done", result: evaluation, rewardId: egg.rewardId };
      }

      const reservationId = randomUUID();
      const pending = {
        ...claimDocData({
          storeHash,
          eggId: input.eggId,
          rewardId: egg.rewardId,
          eventId: egg.eventId,
          rewardNameSnapshot: context.reward.name,
          bcCustomerId: input.bcCustomerId,
          couponCode: null,
          claimedAt: now,
          isForced: false,
          forcedByUserId: null,
          status: "pending",
        }),
        reservationId,
        reservedAt: now,
        previousCustomer: { lastClaimAt: customer.lastClaimAt, lastLat: customer.lastLat, lastLng: customer.lastLng },
      };

      if (takeover) {
        tx.set(claim, pending);
      } else {
        tx.create(claim, pending);
      }

      tx.set(eggCounter, { eventId: egg.eventId, count: counts.egg + 1 }, { merge: true });
      tx.set(rewardCounter, { count: counts.reward + 1 }, { merge: true });
      tx.set(customerDoc, {
        lastClaimAt: now,
        lastLat: input.lat,
        lastLng: input.lng,
        eventCounts: { ...customer.eventCounts, [eventKey]: (customer.eventCounts[eventKey] ?? 0) + 1 },
      });

      return { kind: "reserved", reservationId, reward: context.reward, eventId: egg.eventId, rewardId: egg.rewardId };
    });
  }

  // Releases one reservation, if it is still the one we hold. Idempotent.
  async function release(db: Firestore, storeHash: string, eggId: string, customerId: number, reservationId: string) {
    const claim = claimRef(db, storeHash, eggId, customerId);

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(claim);

      if (!snapshot.exists || snapshot.get("status") !== "pending" || snapshot.get("reservationId") !== reservationId) {
        return;
      }

      const pending = snapshot.data() as DocumentData;
      const eggCounter = eggCounterRef(db, storeHash, eggId);
      const rewardCounter = rewardCounterRef(db, storeHash, pending.rewardId);
      const customerDoc = customerRef(db, storeHash, customerId);
      const [eggCounterSnapshot, rewardCounterSnapshot, customerSnapshot] = await tx.getAll(eggCounter, rewardCounter, customerDoc);
      const undone = undoReservation(pending, readCustomer(customerSnapshot.data()), {
        egg: readCount(eggCounterSnapshot.data()),
        reward: readCount(rewardCounterSnapshot.data()),
      });

      tx.delete(claim);
      tx.set(eggCounter, { count: undone.counts.egg }, { merge: true });
      tx.set(rewardCounter, { count: undone.counts.reward }, { merge: true });
      tx.set(customerDoc, undone.customer);
    });
  }

  // Frees capacity held by reservations whose request died, so a crash cannot
  // make an egg or reward look full forever. Returns how many were released.
  async function sweepExpired(db: Firestore, storeHash: string, eggId: string, rewardId: number | undefined): Promise<number> {
    const claims = storeCollection(db, storeHash, "claims");
    const queries = [claims.where("eggId", "==", eggId).where("status", "==", "pending").get()];

    if (rewardId !== undefined) {
      queries.push(claims.where("rewardId", "==", rewardId).where("status", "==", "pending").get());
    }

    const now = new Date();
    const stale = new Map<string, DocumentData>();

    for (const snapshot of await Promise.all(queries)) {
      for (const doc of snapshot.docs) {
        if (isExpired(doc.data(), now)) {
          stale.set(doc.id, doc.data());
        }
      }
    }

    for (const pending of stale.values()) {
      await release(db, storeHash, pending.eggId, pending.bcCustomerId, pending.reservationId);
    }

    return stale.size;
  }

  async function finalize(
    db: Firestore,
    storeHash: string,
    input: { eggId: string; bcCustomerId: number },
    reservationId: string,
    couponCode: string,
  ): Promise<CreatePlayerClaimResult> {
    const claim = claimRef(db, storeHash, input.eggId, input.bcCustomerId);

    return db.runTransaction(async (tx): Promise<CreatePlayerClaimResult> => {
      const snapshot = await tx.get(claim);

      // Swept (expired) or taken over while the code was being issued: the code
      // is an unused single-use code nobody was shown.
      if (!snapshot.exists || snapshot.get("status") !== "pending" || snapshot.get("reservationId") !== reservationId) {
        return { status: "code_issue_failed" };
      }

      const claimedAt = new Date();

      tx.update(claim, {
        status: "issued",
        couponCode,
        couponCodeNormalized: normalizeCouponCode(couponCode),
        claimedAt,
        reservationId: FieldValue.delete(),
        reservedAt: FieldValue.delete(),
        previousCustomer: FieldValue.delete(),
      });

      return {
        status: "created",
        claim: toClaim({ ...(snapshot.data() as DocumentData), status: "issued", couponCode, claimedAt }),
      };
    });
  }

  return {
    async createPlayerClaim(storeHash, input, hooks) {
      const db = getDb();

      if (!EGG_ID_PATTERN.test(input.eggId)) {
        return { status: "egg_not_found" };
      }

      try {
        let outcome = await reserve(db, storeHash, input, hooks);

        // Capacity can be held by crashed reservations: free those once, then retry.
        if (outcome.kind === "done" && outcome.result.status === "capacity_full") {
          if ((await sweepExpired(db, storeHash, input.eggId, outcome.rewardId)) > 0) {
            outcome = await reserve(db, storeHash, input, hooks);
          }
        }

        if (outcome.kind === "done") {
          return outcome.result;
        }

        const couponCode = await hooks.issueCode(outcome.reward);

        if (couponCode === undefined) {
          await release(db, storeHash, input.eggId, input.bcCustomerId, outcome.reservationId);

          return { status: "code_issue_failed" };
        }

        try {
          return await finalize(db, storeHash, input, outcome.reservationId, couponCode);
        } catch (error) {
          await release(db, storeHash, input.eggId, input.bcCustomerId, outcome.reservationId).catch(() => undefined);

          throw error;
        }
      } catch (error) {
        // A transaction that keeps conflicting gives up with ABORTED (10) or
        // DEADLINE_EXCEEDED (4): the equivalent of the SQL lock timeout.
        const code = (error as { code?: unknown }).code;

        if (code === 10 || code === 4) {
          return { status: "lock_timeout" };
        }

        throw error;
      }
    },
  };
}
