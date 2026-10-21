import type { DocumentData, DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { normalizeCouponCode } from "@/lib/huntry/claims/coupon-code";
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
import type { RewardsRepository } from "@/lib/huntry/repository/types";
import type { CreateRewardInput, HuntryReward } from "@/lib/huntry/rewards/types";

// `stores/{hash}/rewards/{numericId}`, with `productIds` as an array (replacing
// huntry_reward_products) and `couponCodes/{sha256(NORMALIZED code)}` {rewardId}
// as the uniqueness reservation. The reservation is on the trimmed + uppercased
// code, so uniqueness is case-insensitive: deliberately stricter than the SQL
// UNIQUE(store_hash, coupon_code), since BigCommerce codes are case-insensitive.
function toReward(data: DocumentData): HuntryReward {
  return {
    id: data.id,
    storeHash: data.storeHash,
    name: data.name,
    description: data.description,
    sponsorId: data.sponsorId ?? null,
    eggCapacity: data.eggCapacity,
    rewardStartsAt: readDate(data.rewardStartsAt),
    rewardExpiresAt: readDate(data.rewardExpiresAt),
    discountType: data.discountType,
    discountValue: Number(data.discountValue),
    discountScope: data.discountScope,
    productIds: Array.isArray(data.productIds) ? data.productIds : [],
    couponCode: data.couponCode ?? null,
    bcPromotionId: data.bcPromotionId ?? null,
    bcCouponCodeId: data.bcCouponCodeId ?? null,
    bcCustomerGroupId: data.bcCustomerGroupId ?? null,
    status: data.status,
    createdAt: readRequiredDate(data.createdAt),
    updatedAt: readRequiredDate(data.updatedAt),
  };
}

function editableFields(input: CreateRewardInput) {
  return {
    name: input.name,
    description: input.description,
    sponsorId: input.sponsorId,
    eggCapacity: input.eggCapacity,
    rewardStartsAt: input.rewardStartsAt,
    rewardExpiresAt: input.rewardExpiresAt,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountScope: input.discountScope,
    productIds: input.discountScope === "specific" ? input.productIds : [],
    couponCode: input.couponCode,
  };
}

export function createFirestoreRewardsRepository(getDb: () => Firestore = getFirestoreDb): RewardsRepository {
  function couponRef(db: Firestore, storeHash: string, couponCode: string): DocumentReference {
    return storeDoc(db, storeHash, "couponCodes", sha256Hex(normalizeCouponCode(couponCode)));
  }

  // True when the code is reserved by a reward other than `rewardId`.
  async function isReservedByOther(
    tx: Transaction,
    db: Firestore,
    storeHash: string,
    couponCode: string,
    rewardId: number,
  ): Promise<{ ref: DocumentReference; takenByOther: boolean }> {
    const ref = couponRef(db, storeHash, couponCode);
    const snapshot = await tx.get(ref);

    return { ref, takenByOther: snapshot.exists && snapshot.get("rewardId") !== rewardId };
  }

  return {
    async list(storeHash, sort) {
      const snapshot = await storeCollection(getDb(), storeHash, "rewards").get();
      const rewards = snapshot.docs.map((doc) => toReward(doc.data()));

      rewards.sort((a, b) =>
        sort === "time"
          ? compareNullableDates(a.rewardStartsAt, b.rewardStartsAt) || compareStrings(a.name, b.name)
          : compareStrings(a.name, b.name),
      );

      return rewards;
    },

    async get(storeHash, id) {
      const snapshot = await storeDoc(getDb(), storeHash, "rewards", id).get();

      return snapshot.exists ? toReward(snapshot.data() as DocumentData) : undefined;
    },

    async count(storeHash) {
      const aggregate = await storeCollection(getDb(), storeHash, "rewards").count().get();

      return aggregate.data().count;
    },

    async isCouponCodeTaken(storeHash, couponCode, excludeId) {
      const snapshot = await couponRef(getDb(), storeHash, couponCode).get();

      return snapshot.exists && snapshot.get("rewardId") !== excludeId;
    },

    async create(storeHash, input) {
      const db = getDb();

      return db.runTransaction(async (tx) => {
        const reserved = await reserveNumericId(db, tx, storeHash, "rewards");
        const { ref: reservationRef, takenByOther } = await isReservedByOther(
          tx,
          db,
          storeHash,
          input.couponCode,
          reserved.id,
        );

        if (takenByOther) {
          throw new UniqueConstraintError("rewards.coupon_code");
        }

        const now = new Date();
        const data = {
          id: reserved.id,
          storeHash,
          ...editableFields(input),
          bcPromotionId: null,
          bcCouponCodeId: null,
          bcCustomerGroupId: null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };

        tx.set(reservationRef, { rewardId: reserved.id });
        tx.set(storeDoc(db, storeHash, "rewards", reserved.id), data);
        reserved.commit();

        return toReward(data);
      });
    },

    async update(storeHash, id, input) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "rewards", id);

      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);

        if (!snapshot.exists) {
          return undefined;
        }

        const existing = snapshot.data() as DocumentData;
        const { ref: reservationRef, takenByOther } = await isReservedByOther(tx, db, storeHash, input.couponCode, id);

        if (takenByOther) {
          throw new UniqueConstraintError("rewards.coupon_code");
        }

        const previousCode = typeof existing.couponCode === "string" ? existing.couponCode : null;
        const next = { ...existing, ...editableFields(input), updatedAt: new Date() };

        // Release the old reservation when the code changed to a different one.
        if (previousCode !== null && normalizeCouponCode(previousCode) !== normalizeCouponCode(input.couponCode)) {
          tx.delete(couponRef(db, storeHash, previousCode));
        }

        tx.set(reservationRef, { rewardId: id });
        tx.set(ref, next);

        return toReward(next);
      });
    },

    async updateCouponFields(storeHash, id, fields) {
      // update() fails on a missing doc, which matches the SQL no-op closely
      // enough for a reward that was deleted mid-sync; swallow only that case.
      try {
        await storeDoc(getDb(), storeHash, "rewards", id).update({
          bcPromotionId: fields.bcPromotionId,
          bcCouponCodeId: fields.bcCouponCodeId,
          bcCustomerGroupId: fields.bcCustomerGroupId,
          updatedAt: new Date(),
        });
      } catch (error) {
        if ((error as { code?: unknown }).code !== 5) {
          throw error;
        }
      }
    },

    // A hard delete. Cascades to the reward's eggs (like the SQL FK) and
    // releases its coupon reservation and counter; claims are never touched.
    async delete(storeHash, id) {
      const db = getDb();
      const ref = storeDoc(db, storeHash, "rewards", id);
      const snapshot = await ref.get();

      if (!snapshot.exists) {
        return false;
      }

      await deleteEggsOf(db, storeHash, "rewardId", id);

      const couponCode = snapshot.get("couponCode");

      await deleteRefs(db, [
        ref,
        storeDoc(db, storeHash, "counters", `reward_${id}`),
        ...(typeof couponCode === "string" ? [couponRef(db, storeHash, couponCode)] : []),
      ]);

      return true;
    },
  };
}
