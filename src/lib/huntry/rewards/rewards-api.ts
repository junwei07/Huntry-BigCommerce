import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { ApiRequestParams, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";
import { safeStorefrontPath } from "@/lib/huntry/rewards/reward-display";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import {
  addMockReward,
  deleteMockReward,
  MOCK_REWARDS,
  updateMockReward,
  updateMockRewardCouponFields,
} from "@/lib/huntry/rewards/mock/mock-rewards";
import {
  BcProductSummary,
  CreateRewardInput,
  HuntryReward,
  PRODUCTS_PATH,
  RewardCouponFields,
  RewardSort,
  RewardsQuery,
  UpdateRewardInput,
} from "@/lib/huntry/rewards/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

async function fetchRewardsFromDb(query: RewardsQuery, storeHash: string): Promise<HuntryReward[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(REWARDS_LIST_TAG);
  // @cache-components-only:end

  const rewards = await getHuntryRepository().rewards.list(storeHash, query.sort);

  // @cache-components-only:start
  for (const reward of rewards) {
    cacheTag(rewardTag(reward.id));
  }
  // @cache-components-only:end

  return rewards;
}

async function fetchRewardFromDb(id: number, storeHash: string): Promise<HuntryReward | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(rewardTag(id));
  // @cache-components-only:end

  return getHuntryRepository().rewards.get(storeHash, id);
}

// Matches orderBySql's two orderings. "time" is nulls-last — a reward with
// no start date sorts after every dated one.
function sortMockRewards(rewards: HuntryReward[], sort: RewardSort): HuntryReward[] {
  return [...rewards].sort((a, b) => {
    if (sort === "time" && (a.rewardStartsAt || b.rewardStartsAt)) {
      if (!a.rewardStartsAt) {
        return 1;
      }

      if (!b.rewardStartsAt) {
        return -1;
      }

      const diff = a.rewardStartsAt.getTime() - b.rewardStartsAt.getTime();

      if (diff !== 0) {
        return diff;
      }
    }

    return a.name.localeCompare(b.name);
  });
}

// MOCK mode never touches the repository — it returns deterministic fixture
// data instead, matching fetchSponsors/fetchEvents's own MOCK behavior and
// the app's DATA_MODE philosophy.
export async function fetchRewards(query: RewardsQuery, storeHash: string | undefined): Promise<HuntryReward[]> {
  if (getDataMode() === "MOCK") {
    return sortMockRewards(MOCK_REWARDS, query.sort);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return fetchRewardsFromDb(query, resolvedStoreHash);
}

export async function fetchReward(id: number, storeHash: string | undefined): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.find((reward) => reward.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return fetchRewardFromDb(id, resolvedStoreHash);
}

// Uncached counterpart to fetchReward — used by updateHuntryReward to
// preserve bcPromotionId/bcCouponCodeId/bcCustomerGroupId/status (none of
// which are edit-form fields) right before writing, the same reasoning
// fetchEventUncached/fetchSponsorUncached document: a Server Action about to
// mutate a record should never trust a cached read.
export async function fetchRewardUncached(id: number, storeHash: string | undefined): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.find((reward) => reward.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return getHuntryRepository().rewards.get(resolvedStoreHash, id);
}

// Primary uniqueness check (BC-HUN-020) — called by the Server Actions
// before createReward/updateReward, so a duplicate coupon code surfaces as
// a specific form error instead of a confusing write failure after the
// reward row is already committed. excludeId lets an update check against
// every *other* reward in the store without flagging its own current code.
// MOCK mode checks MOCK_REWARDS directly rather than a DB round trip.
export async function isRewardCouponCodeTaken(
  storeHash: string | undefined,
  couponCode: string,
  excludeId?: number,
): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.some((reward) => reward.couponCode === couponCode && reward.id !== excludeId);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  return getHuntryRepository().rewards.isCouponCodeTaken(resolvedStoreHash, couponCode, excludeId);
}

// Race-condition backstop behind isRewardCouponCodeTaken's primary
// pre-check — true when an error means the new
// huntry_rewards_store_hash_coupon_code_key UNIQUE constraint
// (db/migrations/0002_reward_coupon_code_unique.sql) was violated, as
// opposed to any other write failure. Mirrors events-api.ts's
// isUniqueSlugConstraintError exactly (Postgres SQLSTATE 23505, SQLite's
// message-substring check — neither driver exposes a structured constraint
// identifier any more precise than that).
export function isUniqueCouponCodeConstraintError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") {
    return true;
  }

  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

// MOCK mode pushes into the in-memory fixture array instead of throwing,
// matching createEvent/createSponsor's precedent — Huntry's own concepts are
// "MOCK-mode testable: Yes" per docs/MIGRATION.md §6.
export async function createReward(input: CreateRewardInput, storeHash: string | undefined): Promise<HuntryReward> {
  if (getDataMode() === "MOCK") {
    return addMockReward(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a reward.");
  }

  return getHuntryRepository().rewards.create(resolvedStoreHash, input);
}

// Uncached on purpose — used by createHuntryReward to enforce MAX_REWARDS
// right before an insert, which must never trust a cached read.
export async function countRewards(storeHash: string | undefined): Promise<number> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.length;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return 0;
  }

  return getHuntryRepository().rewards.count(resolvedStoreHash);
}

// Returns undefined if no row matched (already deleted, or belongs to a
// different store) — the caller reports that as "no longer exists" rather
// than treating it as an unexpected error, mirroring updateEvent/
// updateSponsor.
export async function updateReward(
  id: number,
  input: UpdateRewardInput,
  storeHash: string | undefined,
): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return updateMockReward(id, input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return getHuntryRepository().rewards.update(resolvedStoreHash, id, input);
}

// The sole writer of the two BigCommerce-id columns — called only from
// coupon-sync.ts's Server Action call sites (BC-HUN-020), never from the
// reward form's own create/update path above, which never touches these
// columns at all (CreateRewardInput/UpdateRewardInput omit them). A single-
// statement write, no transaction needed (no child-table replace, unlike
// createReward/updateReward).
export async function updateRewardCouponFields(
  id: number,
  storeHash: string | undefined,
  fields: RewardCouponFields,
): Promise<void> {
  if (getDataMode() === "MOCK") {
    updateMockRewardCouponFields(id, fields);
    return;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return;
  }

  await getHuntryRepository().rewards.updateCouponFields(resolvedStoreHash, id, fields);
}

// A genuine hard delete, per the user's explicit direction (EVMS-style, no
// archive workflow — see types.ts's RewardStatus comment; this diverges from
// docs/MIGRATION.md's documented archive-vs-hard-delete split). Cascades
// huntry_reward_products and huntry_eggs via their existing
// `ON DELETE CASCADE` FKs; never touches huntry_claims (denormalized, no FK,
// by schema design — a reward's past claims stay intact after the reward
// row itself is gone).
//
// BC-HUN-021 considered extending this to disable (never delete) a
// reward's live Promotion before/after removing the row, mirroring
// huntry/docs/decisions/0001-coupon-delete-asymmetry.md's unlink-not-
// disable precedent — but after review, a deleted reward doesn't need to
// stop its coupon from being redeemable by customers who already claimed
// it. This stays a plain DB delete; the Promotion/coupon/Customer Group
// are left alone in BigCommerce, same orphaned-coupon precedent the
// legacy plugin used.
export async function deleteReward(id: number, storeHash: string | undefined): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return deleteMockReward(id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  return getHuntryRepository().rewards.delete(resolvedStoreHash, id);
}

// Backs the discountScope === "specific" product picker (BC-HUN-019).
// Reuses this app's existing getRestApiClient — in MOCK mode that resolves
// to MockRestApiClient, routed to mock/products-list-handler.ts's fixture
// data; no new REST client needed (docs/MIGRATION.md §2's own instruction).
export async function fetchBcProductsForPicker(
  storeHash: string | undefined,
  searchTerm?: string,
): Promise<BcProductSummary[]> {
  const apiClient = await getRestApiClient(storeHash);
  const params: ApiRequestParams = { limit: 50 };

  if (searchTerm) {
    params["name:like"] = searchTerm;
  }

  const { data: body } = await apiClient.get<V3ListResponse<BcProductSummary>>(PRODUCTS_PATH, { params });

  return body.data;
}

// BC-HUN-046: names and storefront paths for a reward's product scope, for the
// rewards list's "Valid on" line (plugin: huntry_render_reward_product_links).
// Only visible products with a safe same-origin path are returned. Never
// throws: a catalog failure just means no links, not a broken rewards page.
export async function fetchBcProductLinks(
  storeHash: string | undefined,
  productIds: number[],
): Promise<{ name: string; url: string }[]> {
  if (productIds.length === 0) {
    return [];
  }

  try {
    const apiClient = await getRestApiClient(storeHash);
    const { data: body } = await apiClient.get<
      V3ListResponse<{ id: number; name: string; custom_url?: { url?: string } }>
    >(PRODUCTS_PATH, {
      params: { "id:in": productIds.join(","), include_fields: "name,custom_url", is_visible: true, limit: 250 },
    });
    const links: { name: string; url: string }[] = [];

    for (const product of body.data) {
      const url = safeStorefrontPath(product.custom_url?.url);

      if (url && product.name) {
        links.push({ name: product.name, url });
      }
    }

    return links;
  } catch {
    return [];
  }
}
