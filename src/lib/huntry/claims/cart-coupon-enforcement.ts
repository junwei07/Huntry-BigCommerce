import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { isNotFoundError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { findClaimsByCouponCodes, normalizeCouponCode, RedemptionCandidate } from "@/lib/huntry/claims/redemption";

// A reward's per-claim code (BC-HUN-032) belongs to the customer who claimed
// it, but its Promotion has no eligibility condition, so BigCommerce itself
// lets anyone apply it. There is no synchronous validation hook, so this
// enforces after the fact, within seconds of the code being applied: the
// `store/cart/couponApplied` webhook re-fetches the cart and removes a claim
// code that belongs to someone else. BC-HUN-041 (claims/redemption.ts) stays
// the last net for an order placed before the removal landed.

// A cart reporting customer_id 0 is a guest — or a logged-in shopper whose
// cart hasn't picked up their id yet, in which case removing would strip the
// legitimate claimer's code. So guests are left alone (BC-HUN-041 still flags
// the order) unless this is switched on after the live probe has shown that
// logged-in carts reliably report their id.
export function shouldRemoveGuestCartCoupons(): boolean {
  return process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS?.toLowerCase() === "true";
}

// Lets a cart that was just associated with a login settle before a guest
// verdict is acted on.
const GUEST_RECHECK_DELAY_MS = 2000;

// Pure decision. Returns the cart's own coupon codes (as BigCommerce reports
// them) that must be removed: a code that matches a claim row, where no
// matching row belongs to the cart's customer. Codes matching no claim are
// ordinary store coupons and never touched. See shouldRemoveGuestCartCoupons
// for `removeGuest`.
export function evaluateCartCoupons(
  cartCustomerId: number,
  cartCodes: string[],
  claims: RedemptionCandidate[],
  options: { removeGuest: boolean },
): string[] {
  if (cartCustomerId === 0 && !options.removeGuest) {
    return [];
  }

  const claimsByCode = new Map<string, RedemptionCandidate[]>();

  for (const claim of claims) {
    const code = normalizeCouponCode(claim.couponCode);

    claimsByCode.set(code, [...(claimsByCode.get(code) ?? []), claim]);
  }

  return cartCodes.filter((cartCode) => {
    const owners = claimsByCode.get(normalizeCouponCode(cartCode));

    return owners !== undefined && !owners.some((claim) => claim.bcCustomerId === cartCustomerId);
  });
}

interface CartSnapshot {
  customerId: number;
  codes: string[];
}

// The Checkout API shape is read defensively — it has not been probed live
// (docs/MIGRATION.md §8): customer id at `cart.customer_id`, codes at
// `coupons[].code`. A missing customer id throws rather than defaulting to 0,
// so an unexpected shape can never turn into removing a legitimate code.
async function readCart(client: BcRestApiClient, cartId: string): Promise<CartSnapshot> {
  const { data: body } = await client.get<{
    data?: { cart?: { customer_id?: unknown }; coupons?: { code?: unknown }[] };
  }>(`/v3/checkouts/${encodeURIComponent(cartId)}`);
  const checkout = body?.data;
  const customerId = checkout?.cart?.customer_id;

  if (typeof customerId !== "number") {
    throw new Error(`Checkout ${cartId} came back without a numeric cart.customer_id.`);
  }

  const codes = Array.isArray(checkout?.coupons)
    ? checkout.coupons.map((coupon) => coupon.code).filter((code): code is string => typeof code === "string")
    : [];

  return { customerId, codes };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Called by the cart webhook route with only the cart id from the unsigned
// payload; the customer and coupons come from BigCommerce's own API.
export async function enforceCartCoupons(
  storeHash: string,
  cartId: string,
  client: BcRestApiClient,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ removed: string[] }> {
  if (getDataMode() === "MOCK") {
    return { removed: [] };
  }

  const removeGuest = shouldRemoveGuestCartCoupons();
  let cart = await readCart(client, cartId);

  if (cart.customerId === 0 && removeGuest && cart.codes.length > 0) {
    await sleep(GUEST_RECHECK_DELAY_MS);
    cart = await readCart(client, cartId);
  }

  if (cart.codes.length === 0) {
    return { removed: [] };
  }

  const claims = await findClaimsByCouponCodes(storeHash, cart.codes);
  const foreign = evaluateCartCoupons(cart.customerId, cart.codes, claims, { removeGuest });
  const removed: string[] = [];

  for (const code of foreign) {
    try {
      // BigCommerce's example sends an empty JSON object as the body.
      await client.delete(`/v3/checkouts/${encodeURIComponent(cartId)}/coupons/${encodeURIComponent(code)}`, { body: {} });
      removed.push(code);
    } catch (error) {
      // Already gone (shopper or the storefront guard removed it first).
      if (!isNotFoundError(error)) {
        logError(`enforceCartCoupons: store "${storeHash}" removing a claim code`, error);
      }
    }
  }

  return { removed };
}
