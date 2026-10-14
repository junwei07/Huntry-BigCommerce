import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import type { EventFields, EventTheme } from "@/lib/huntry/events/types";
import {
  compareNullableDates,
  compareStrings,
  deleteRefs,
  readDate,
  readRequiredDate,
  sha256Hex,
} from "@/lib/huntry/repository/firestore/convert";
import { reserveNumericId } from "@/lib/huntry/repository/firestore/counters";
import { deleteEggsOf } from "@/lib/huntry/repository/firestore/eggs-cleanup";
import { UniqueConstraintError } from "@/lib/huntry/repository/firestore/errors";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { EventsRepository } from "@/lib/huntry/repository/types";

// `stores/{hash}/events/{numericId}`, plus `slugs/{sha256(slug)}` {eventId}: the
// reservation that replaces UNIQUE(store_hash, slug). The slug never changes on
// edit, so only create and delete touch it.
function toEvent(data: DocumentData): EventFields {
  return {
    id: data.id,
    storeHash: data.storeHash,
    name: data.name,
    slug: data.slug,
    description: data.description,
    startsAt: readDate(data.startsAt),
    endsAt: readDate(data.endsAt),
    headerBannerUrl: data.headerBannerUrl ?? null,
    markerRadiusMeters: data.markerRadiusMeters,
    maxGrabCount: data.maxGrabCount,
    eggClaimCapacity: data.eggClaimCapacity,
    theme: data.theme as EventTheme,
    isFeatured: Boolean(data.isFeatured),
    featuredOrder: data.featuredOrder ?? null,
    createdAt: readRequiredDate(data.createdAt),
    updatedAt: readRequiredDate(data.updatedAt),
  };
}

export function createFirestoreEventsRepository(getDb: () => Firestore = getFirestoreDb): EventsRepository {
  return {
    async list(storeHash, sort) {
      const snapshot = await storeCollection(getDb(), storeHash, "events").get();
      const events = snapshot.docs.map((doc) => toEvent(doc.data()));

      events.sort((a, b) =>
        sort === "name"
          ? compareStrings(a.name, b.name)
          : compareNullableDates(a.startsAt, b.startsAt) || compareStrings(a.name, b.name),
      );

      return events;
    },

    async get(storeHash, id) {
      const snapshot = await storeDoc(getDb(), storeHash, "events", id).get();

      return snapshot.exists ? toEvent(snapshot.data() as DocumentData) : undefined;
    },

    async count(storeHash) {
      const aggregate = await storeCollection(getDb(), storeHash, "events").count().get();

      return aggregate.data().count;
    },

    async create(storeHash, input, slug) {
      const db = getDb();

      return db.runTransaction(async (tx) => {
        const slugRef = storeDoc(db, storeHash, "slugs", sha256Hex(slug));
        const slugSnapshot = await tx.get(slugRef);
        const reserved = await reserveNumericId(db, tx, storeHash, "events");

        if (slugSnapshot.exists) {
          throw new UniqueConstraintError("events.slug");
        }

        const now = new Date();
        const data = {
          id: reserved.id,
          storeHash,
          name: input.name,
          slug,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          headerBannerUrl: input.headerBannerUrl,
          markerRadiusMeters: input.markerRadiusMeters,
          maxGrabCount: input.maxGrabCount,
          eggClaimCapacity: input.eggClaimCapacity,
          theme: input.theme,
          isFeatured: input.isFeatured,
          featuredOrder: input.featuredOrder,
          createdAt: now,
          updatedAt: now,
        };

        tx.set(slugRef, { eventId: reserved.id });
        tx.set(storeDoc(db, storeHash, "events", reserved.id), data);
        reserved.commit();

        return toEvent(data);
      });
    },

    async update(storeHash, id, input) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "events", id);

      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);

        if (!snapshot.exists) {
          return undefined;
        }

        // Slug, id and createdAt are never touched on edit.
        const next = {
          ...(snapshot.data() as DocumentData),
          name: input.name,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          headerBannerUrl: input.headerBannerUrl,
          markerRadiusMeters: input.markerRadiusMeters,
          maxGrabCount: input.maxGrabCount,
          eggClaimCapacity: input.eggClaimCapacity,
          theme: input.theme,
          isFeatured: input.isFeatured,
          featuredOrder: input.featuredOrder,
          updatedAt: new Date(),
        };

        tx.set(ref, next);

        return toEvent(next);
      });
    },

    // A hard delete that cascades to the event's eggs, like the SQL FK. The
    // eggs go first: a crash in between leaves an event without eggs, never
    // eggs without their event. Claims are never touched.
    async delete(storeHash, id) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "events", id);
      const snapshot = await ref.get();

      if (!snapshot.exists) {
        return false;
      }

      await deleteEggsOf(db, storeHash, "eventId", id);

      const slug = snapshot.get("slug");

      await deleteRefs(db, [ref, ...(typeof slug === "string" ? [storeDoc(db, storeHash, "slugs", sha256Hex(slug))] : [])]);

      return true;
    },
  };
}
