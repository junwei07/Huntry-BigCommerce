import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseStoreHash } from "@/lib/bc-auth/verify-signed-payload";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";

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

// Registered by register-webhooks.ts. Scaffold only: verifies the request
// is well-formed, then re-fetches the order from BigCommerce's own API
// using the stored access token — never acts on the payload's own contents
// directly, since unlike this app's JWTs, webhook payloads aren't
// cryptographically signed (docs/MIGRATION.md §4's trust-boundary rule).
// Matching (coupon_code, bc_customer_id) against huntry_claims to mark
// claims redeemed is BC-HUN-041 (Week 4) — not implemented here.
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = orderWebhookPayloadSchema.parse(await request.json());
    const storeHash = parseStoreHash(body.producer);
    const accessToken = await getCredentialsStore().getStoreToken(storeHash);

    if (!accessToken) {
      throw new Error(`No stored access token for store "${storeHash}".`);
    }

    const restApiClient = await getRestApiClient(storeHash, accessToken);

    await restApiClient.get(`/v2/orders/${body.data.id}`);
  } catch (error) {
    logError("POST /api/webhooks/huntry/order", error);
  }

  // Always acknowledge receipt: this route has nothing yet (BC-HUN-041)
  // that a BigCommerce retry would help complete.
  return NextResponse.json({ received: true }, { status: 200 });
}
