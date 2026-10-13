import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseStoreHash } from "@/lib/bc-auth/verify-signed-payload";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { eventClaimsTag } from "@/lib/huntry/claims/cache-tags";
import { processOrderCreated } from "@/lib/huntry/claims/redemption";

// BigCommerce's documented webhook envelope — only the fields this route
// actually reads. producer is "stores/{hash}", the same shape as the OAuth
// context claim (see parseStoreHash).
const orderWebhookPayloadSchema = z.object({
  scope: z.string(),
  producer: z.string(),
  data: z.object({
    type: z.string(),
    id: z.number(),
  }),
});

const ORDER_CREATED_SCOPE = "store/order/created";

// Registered by register-webhooks.ts. Verifies the request is well-formed,
// then hands only the order id to processOrderCreated, which re-fetches the
// order from BigCommerce's own API using the stored access token — never
// acts on the payload's own contents directly, since unlike this app's JWTs,
// webhook payloads aren't cryptographically signed (docs/MIGRATION.md §4's
// trust-boundary rule). Matching coupon codes to huntry_claims and marking
// them redeemed/flagged is BC-HUN-041 (claims/redemption.ts).
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = orderWebhookPayloadSchema.parse(await request.json());

    if (body.scope !== ORDER_CREATED_SCOPE) {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const storeHash = parseStoreHash(body.producer);
    const accessToken = await getCredentialsStore().getStoreToken(storeHash);

    if (!accessToken) {
      throw new Error(`No stored access token for store "${storeHash}".`);
    }

    const restApiClient = await getRestApiClient(storeHash, accessToken);

    const { eventIds } = await processOrderCreated(storeHash, body.data.id, restApiClient);

    // Same invalidation as the public claim route: the admin Overview's Game
    // activity is cached per event and now shows the redemption status.
    for (const eventId of eventIds) {
      revalidateTag(eventClaimsTag(eventId), { expire: 0 });
    }
  } catch (error) {
    logError("POST /api/webhooks/huntry/order", error);
  }

  // Always acknowledge receipt: an unsigned, possibly forged request that
  // fails here gains nothing from a BigCommerce retry, and failures are
  // logged above.
  return NextResponse.json({ received: true }, { status: 200 });
}
