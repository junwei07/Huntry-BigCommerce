import { NextResponse } from "next/server";
import { z } from "zod";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { evaluateCartCoupons } from "@/lib/huntry/claims/cart-coupon-enforcement";
import { findClaimsByCouponCodes } from "@/lib/huntry/claims/redemption";
import { buildCorsHeaders, buildPreflightHeaders } from "@/lib/huntry/public-api/cors";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

// A cart holds a handful of coupons; the cap keeps one request's lookup small.
const MAX_CODES = 20;

// `jwt` is absent for a guest. A present-but-invalid JWT is a 401, never
// silently treated as a guest.
const validateBodySchema = z.object({
  jwt: z.string().min(1).optional(),
  codes: z.array(z.string().min(1).max(100)).min(1).max(MAX_CODES),
});

// Public, cookie-less route (docs/MIGRATION.md §4), same trust model as the
// claims route: the customer comes from the signed JWT, never the body.
async function isKnownStore(storeHash: string): Promise<boolean> {
  return (
    STORE_HASH_PATTERN.test(storeHash) &&
    (getDataMode() !== "MULTITENANT" || Boolean(await getCredentialsStore().getStoreToken(storeHash)))
  );
}

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;

  const headers = (await isKnownStore(storeHash))
    ? await buildPreflightHeaders(request.headers.get("origin"), storeHash)
    : { Vary: "Origin" };

  return new NextResponse(null, { status: 204, headers });
}

// BC-HUN-050: the storefront cart guard's question — "which of these codes in
// my cart are reward codes that belong to someone else?". Advisory UX only; the
// enforcing layer is the cart webhook (claims/cart-coupon-enforcement.ts), and
// this applies the same ownership rule. Answers only with the submitted codes
// themselves, never who owns them.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;
  let cors: Record<string, string> = { Vary: "Origin" };
  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

  try {
    if (!(await isKnownStore(storeHash))) {
      return respond({ error: "Not found." }, 404);
    }

    cors = await buildCorsHeaders(request.headers.get("origin"), storeHash);

    const body = validateBodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return respond({ error: "Invalid request." }, 400);
    }

    let customerId = 0;

    if (body.data.jwt) {
      const auth = await isAuthorizedForStorefrontCustomer(body.data.jwt, storeHash);

      if (!auth.ok) {
        return respond({ error: "Unauthorized." }, 401);
      }

      customerId = auth.customerId;
    }

    const claims = await findClaimsByCouponCodes(storeHash, body.data.codes);
    // Unlike the webhook, a guest is flagged here: no JWT means the live
    // /customer/current.jwt really found no session, whereas the webhook's
    // cart.customer_id can lag a login (so it defaults to leaving guests alone,
    // see shouldRemoveGuestCartCoupons). A claim code is only ever usable by
    // its claimer, who is by definition logged in.
    const foreign = evaluateCartCoupons(customerId, body.data.codes, claims, { removeGuest: true });

    return respond({ foreign }, 200);
  } catch (error) {
    logError(`validate-coupon: store "${storeHash}"`, error);

    return respond({ error: "Failed to validate coupons." }, 500);
  }
}
