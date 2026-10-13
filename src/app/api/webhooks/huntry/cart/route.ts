import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseStoreHash } from "@/lib/bc-auth/verify-signed-payload";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { enforceCartCoupons } from "@/lib/huntry/claims/cart-coupon-enforcement";

// BigCommerce's cart webhook envelope — only what this route reads. Cart ids
// are UUID strings (unlike the numeric order ids); couponApplied carries extra
// fields, so the schema is loose.
const cartWebhookPayloadSchema = z.object({
  scope: z.string(),
  producer: z.string(),
  data: z.object({
    type: z.string(),
    id: z.string().min(1).max(100),
  }),
});

const COUPON_APPLIED_SCOPE = "store/cart/couponApplied";

// Registered by register-webhooks.ts. Same trust boundary as the order route
// (docs/MIGRATION.md §4): the payload is unsigned, so only the cart id is used
// and everything else is re-fetched from BigCommerce with the stored token. A
// claim code applied by anyone but its claimer is removed from the cart
// (claims/cart-coupon-enforcement.ts, BC-HUN-049).
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = cartWebhookPayloadSchema.parse(await request.json());

    if (body.scope !== COUPON_APPLIED_SCOPE) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const storeHash = parseStoreHash(body.producer);
    const accessToken = await getCredentialsStore().getStoreToken(storeHash);

    if (!accessToken) {
      throw new Error(`No stored access token for store "${storeHash}".`);
    }

    const restApiClient = await getRestApiClient(storeHash, accessToken);

    await enforceCartCoupons(storeHash, body.data.id, restApiClient);
  } catch (error) {
    logError("POST /api/webhooks/huntry/cart", error);
  }

  // Always acknowledge: an unsigned, possibly forged request that fails here
  // gains nothing from a retry, and failures are logged above.
  return NextResponse.json({ received: true }, { status: 200 });
}
