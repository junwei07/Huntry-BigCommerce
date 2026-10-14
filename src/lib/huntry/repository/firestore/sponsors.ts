import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { compareStrings, deleteRefs, readRequiredDate } from "@/lib/huntry/repository/firestore/convert";
import { reserveNumericId } from "@/lib/huntry/repository/firestore/counters";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { SponsorsRepository } from "@/lib/huntry/repository/types";
import type { HuntrySponsor } from "@/lib/huntry/sponsors/types";

// `stores/{hash}/sponsors/{numericId}`.
function toSponsor(data: DocumentData): HuntrySponsor {
  return {
    id: data.id,
    storeHash: data.storeHash,
    name: data.name,
    logoUrl: data.logoUrl ?? null,
    instagramUrl: data.instagramUrl ?? null,
    facebookUrl: data.facebookUrl ?? null,
    websiteUrl: data.websiteUrl ?? null,
    location: data.location ?? null,
    createdAt: readRequiredDate(data.createdAt),
    updatedAt: readRequiredDate(data.updatedAt),
  };
}

export function createFirestoreSponsorsRepository(getDb: () => Firestore = getFirestoreDb): SponsorsRepository {
  return {
    async list(storeHash, direction) {
      const snapshot = await storeCollection(getDb(), storeHash, "sponsors").get();
      const sponsors = snapshot.docs.map((doc) => toSponsor(doc.data()));

      sponsors.sort((a, b) => compareStrings(a.name, b.name) * (direction === "DESC" ? -1 : 1));

      return sponsors;
    },

    async get(storeHash, id) {
      const snapshot = await storeDoc(getDb(), storeHash, "sponsors", id).get();

      return snapshot.exists ? toSponsor(snapshot.data() as DocumentData) : undefined;
    },

    async create(storeHash, input) {
      const db = getDb();

      return db.runTransaction(async (tx) => {
        const reserved = await reserveNumericId(db, tx, storeHash, "sponsors");
        const now = new Date();
        const data = {
          id: reserved.id,
          storeHash,
          name: input.name,
          logoUrl: input.logoUrl,
          instagramUrl: input.instagramUrl,
          facebookUrl: input.facebookUrl,
          websiteUrl: input.websiteUrl,
          location: input.location,
          createdAt: now,
          updatedAt: now,
        };

        tx.set(storeDoc(db, storeHash, "sponsors", reserved.id), data);
        reserved.commit();

        return toSponsor(data);
      });
    },

    async update(storeHash, id, input) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "sponsors", id);

      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);

        if (!snapshot.exists) {
          return undefined;
        }

        const next = {
          ...(snapshot.data() as DocumentData),
          name: input.name,
          logoUrl: input.logoUrl,
          instagramUrl: input.instagramUrl,
          facebookUrl: input.facebookUrl,
          websiteUrl: input.websiteUrl,
          location: input.location,
          updatedAt: new Date(),
        };

        tx.set(ref, next);

        return toSponsor(next);
      });
    },

    // Detaches the sponsor from its rewards first, as the SQL implementation
    // does explicitly (SQLite never enforces the FK's ON DELETE SET NULL).
    async delete(storeHash, id) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "sponsors", id);

      if (!(await ref.get()).exists) {
        return false;
      }

      const rewards = await storeCollection(db, storeHash, "rewards").where("sponsorId", "==", id).get();

      for (let start = 0; start < rewards.docs.length; start += 400) {
        const batch = db.batch();

        for (const reward of rewards.docs.slice(start, start + 400)) {
          batch.update(reward.ref, { sponsorId: null });
        }

        await batch.commit();
      }

      await deleteRefs(db, [ref]);

      return true;
    },
  };
}
