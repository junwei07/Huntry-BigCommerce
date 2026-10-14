import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { ClaimId, RedemptionStatus } from "@/lib/huntry/claims/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// BC-HUN-041: the detective safety net behind per-claim coupon codes
// (BC-HUN-032). BigCommerce has no synchronous "may this customer use this
// code" hook, so after an order is created the webhook handler looks up which
// claim each coupon code on the order belongs to and records the outcome.
// Everything here runs on data re-fetched from BigCommerce — the webhook
// payload itself is unsigned and never trusted (docs/MIGRATION.md §4).

export interface RedemptionCandidate {
  id: ClaimId;
  eventId: number;
  bcCustomerId: number;
  couponCode: string;
  redemptionStatus: RedemptionStatus;
}

export interface RedemptionUpdate {
  claimId: ClaimId;
  status: Exclude<RedemptionStatus, "unredeemed">;
}

// BigCommerce echoes the code as the shopper typed it, while issued codes are
// generated uppercase (rewards/claim-codes.ts), so both sides are compared
// trimmed + uppercased.
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

// Pure decision: given the claims whose code appeared on an order, which get
// marked and how. A per-claim code maps to exactly one claim, but
// huntry_claims has no UNIQUE(store_hash, coupon_code), so if a code ever maps
// to several rows the order's customer breaks the tie: the matching row is
// `redeemed`; with no matching row every row for that code is flagged.
// Guest orders (customer_id 0) never match a claim's customer, so they flag.
export function evaluateRedemption(orderCustomerId: number, claims: RedemptionCandidate[]): RedemptionUpdate[] {
  const claimsByCode = new Map<string, RedemptionCandidate[]>();

  for (const claim of claims) {
    const code = normalizeCouponCode(claim.couponCode);

    claimsByCode.set(code, [...(claimsByCode.get(code) ?? []), claim]);
  }

  const updates: RedemptionUpdate[] = [];

  for (const group of claimsByCode.values()) {
    const owner = group.find((claim) => claim.bcCustomerId === orderCustomerId);

    if (owner) {
      updates.push({ claimId: owner.id, status: "redeemed" });
    } else {
      updates.push(...group.map((claim): RedemptionUpdate => ({ claimId: claim.id, status: "flagged_unauthorized_use" })));
    }
  }

  return updates;
}

// Scoped by store: a code from another store's order can never touch this
// store's claims. Matching is case-insensitive (see normalizeCouponCode).
export async function findClaimsByCouponCodes(storeHash: string, codes: string[]): Promise<RedemptionCandidate[]> {
  const normalized = [...new Set(codes.map(normalizeCouponCode).filter(Boolean))];

  if (normalized.length === 0) {
    return [];
  }

  return getHuntryRepository().claims.findClaimsByNormalizedCouponCodes(storeHash, normalized);
}

// Idempotent: only a claim still `unredeemed` is written, so a redelivered
// webhook (or a second order carrying the same code) can never flip an
// already-decided claim. Returns how many rows actually changed.
export async function markRedemptions(
  storeHash: string,
  orderId: number,
  updates: RedemptionUpdate[],
): Promise<number> {
  return getHuntryRepository().claims.markRedemptions(storeHash, orderId, updates);
}

interface BcOrder {
  customer_id: number;
}

interface BcOrderCoupon {
  code: string;
}

// Called by the order webhook route (BC-HUN-040) with only the order id taken
// from the payload. The customer and coupon codes come from BigCommerce's own
// API. An order with no coupons answers 204, which the REST client returns as
// undefined data.
export async function processOrderCreated(
  storeHash: string,
  orderId: number,
  client: BcRestApiClient,
): Promise<{ matched: number; updated: number; eventIds: number[] }> {
  if (getDataMode() === "MOCK") {
    return { matched: 0, updated: 0, eventIds: [] };
  }

  const { data: order } = await client.get<BcOrder>(`/v2/orders/${orderId}`);

  if (typeof order?.customer_id !== "number") {
    throw new Error(`Order ${orderId} came back without a numeric customer_id.`);
  }

  const { data: coupons } = await client.get<BcOrderCoupon[] | undefined>(`/v2/orders/${orderId}/coupons`);
  const codes = Array.isArray(coupons) ? coupons.map((coupon) => coupon.code).filter((code) => typeof code === "string") : [];

  const claims = await findClaimsByCouponCodes(storeHash, codes);
  const updates = evaluateRedemption(order.customer_id, claims);
  const updated = await markRedemptions(storeHash, orderId, updates);

  // Events whose claim lists changed, so the caller can drop their cached
  // admin views (claims/cache-tags.ts). Empty when nothing was written.
  const eventIds =
    updated > 0 ? [...new Set(claims.filter((claim) => updates.some((u) => u.claimId === claim.id)).map((claim) => claim.eventId))] : [];

  return { matched: claims.length, updated, eventIds };
}
