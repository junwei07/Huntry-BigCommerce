import { randomUUID } from "node:crypto";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { HuntryEgg } from "@/lib/huntry/eggs/types";
import { compareStrings, deleteRefs, readRequiredDate } from "@/lib/huntry/repository/firestore/convert";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { EggsRepository } from "@/lib/huntry/repository/types";

// `stores/{hash}/eggs/{uuid}`. The uuid is the claim key (claims reference it as
// `eggId`), so it never changes on edit.
function toEgg(data: DocumentData): HuntryEgg {
  return {
    id: data.id,
    storeHash: data.storeHash,
    rewardId: data.rewardId,
    eventId: data.eventId,
    name: data.name,
    lat: data.lat,
    lng: data.lng,
    createdAt: readRequiredDate(data.createdAt),
    updatedAt: readRequiredDate(data.updatedAt),
  };
}

// Firestore caps a batch at 500 writes. The per-event and per-reward egg caps
// (eggs/limits.ts, 30 each) keep one Stop Placing commit far below that, so the
// documented "one atomic batch" holds; an oversized request is rejected rather
// than silently split into non-atomic chunks.
const MAX_BATCH = 500;

export function createFirestoreEggsRepository(getDb: () => Firestore = getFirestoreDb): EggsRepository {
  return {
    async listByEvent(storeHash, eventId) {
      const snapshot = await storeCollection(getDb(), storeHash, "eggs").where("eventId", "==", eventId).get();
      const eggs = snapshot.docs.map((doc) => toEgg(doc.data()));

      eggs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || compareStrings(a.id, b.id));

      return eggs;
    },

    async countsByReward(storeHash) {
      const snapshot = await storeCollection(getDb(), storeHash, "eggs").select("rewardId").get();
      const counts = new Map<number, number>();

      for (const doc of snapshot.docs) {
        const rewardId = doc.get("rewardId") as number;

        counts.set(rewardId, (counts.get(rewardId) ?? 0) + 1);
      }

      return counts;
    },

    async get(storeHash, id) {
      const snapshot = await storeDoc(getDb(), storeHash, "eggs", id).get();

      return snapshot.exists ? toEgg(snapshot.data() as DocumentData) : undefined;
    },

    async listPlacedCapacities(storeHash, rewardId) {
      const db = getDb();
      const eggs = await storeCollection(db, storeHash, "eggs").where("rewardId", "==", rewardId).select("eventId").get();

      if (eggs.empty) {
        return [];
      }

      const eventIds = [...new Set(eggs.docs.map((doc) => doc.get("eventId") as number))];
      const events = await db.getAll(...eventIds.map((eventId) => storeDoc(db, storeHash, "events", eventId)));
      const capacityByEvent = new Map<number, number | null>();

      events.forEach((event, index) => {
        // An egg whose event is gone counts as null (the legacy plugin counts it as 1).
        capacityByEvent.set(eventIds[index], event.exists ? (event.get("eggClaimCapacity") as number) : null);
      });

      return eggs.docs.map((doc) => ({ eventClaimCapacity: capacityByEvent.get(doc.get("eventId") as number) ?? null }));
    },

    async listRewardIdsForEvent(storeHash, eventId) {
      const snapshot = await storeCollection(getDb(), storeHash, "eggs")
        .where("eventId", "==", eventId)
        .select("rewardId")
        .get();

      return [...new Set(snapshot.docs.map((doc) => doc.get("rewardId") as number))];
    },

    async createMany(storeHash, inputs) {
      if (inputs.length > MAX_BATCH) {
        throw new Error(`Cannot place more than ${MAX_BATCH} eggs in one batch.`);
      }

      const db = getDb();
      const batch = db.batch();
      const now = new Date();
      const created: HuntryEgg[] = [];

      for (const input of inputs) {
        const id = randomUUID();
        const data = {
          id,
          storeHash,
          rewardId: input.rewardId,
          eventId: input.eventId,
          name: input.name,
          lat: input.lat,
          lng: input.lng,
          createdAt: now,
          updatedAt: now,
        };

        batch.create(storeDoc(db, storeHash, "eggs", id), data);
        created.push(toEgg(data));
      }

      await batch.commit();

      return created;
    },

    // Only reward/name/position and updatedAt change: the id, event and
    // createdAt stay, so claims keyed off the egg id remain linked.
    async update(storeHash, id, input) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "eggs", id);

      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);

        if (!snapshot.exists) {
          return undefined;
        }

        const next = {
          ...(snapshot.data() as DocumentData),
          rewardId: input.rewardId,
          name: input.name,
          lat: input.lat,
          lng: input.lng,
          updatedAt: new Date(),
        };

        tx.set(ref, next);

        return toEgg(next);
      });
    },

    // A hard delete of the egg and its claim counter; claims stay intact.
    async delete(storeHash, id) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "eggs", id);

      if (!(await ref.get()).exists) {
        return false;
      }

      await deleteRefs(db, [ref, storeDoc(db, storeHash, "counters", `egg_${id}`)]);

      return true;
    },
  };
}
