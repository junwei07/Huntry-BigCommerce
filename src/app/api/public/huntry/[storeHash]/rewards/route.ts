import { NextResponse } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/errors/logger";
import { listClaimsForCustomer } from "@/lib/huntry/claims/claims-api";
import { buildCorsHeaders } from "@/lib/huntry/public-api/cors";
import { handlePublicPreflight, isKnownStore } from "@/lib/huntry/public-api/known-store";
import { loadRewardInfo, UNKNOWN_INFO } from "@/lib/huntry/public-api/reward-info";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const bodySchema = z.object({ jwt: z.string().min(1) });

// BC-HUN-046: the storefront's "My rewards" list. Same trust model as the claim
// route (docs/MIGRATION.md §4): no session cookie, the signed customer JWT is
// the access control, and the rows are always the JWT's own customer's.
export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;

  return handlePublicPreflight(request, storeHash);
}

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

    const body = bodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return respond({ error: "Invalid request." }, 400);
    }

    const auth = await isAuthorizedForStorefrontCustomer(body.data.jwt, storeHash);

    if (!auth.ok) {
      return respond({ error: "Unauthorized." }, 401);
    }

    const claims = await listClaimsForCustomer(storeHash, auth.customerId);
    const rewardInfo = await loadRewardInfo(storeHash, [...new Set(claims.map((claim) => claim.rewardId))]);

    return respond(
      {
        claims: claims.map((claim) => ({
          rewardName: claim.rewardNameSnapshot,
          couponCode: claim.couponCode,
          claimedAt: claim.claimedAt.toISOString(),
          eventId: claim.eventId,
          ...(rewardInfo.get(claim.rewardId) ?? UNKNOWN_INFO),
        })),
      },
      200,
    );
  } catch (error) {
    logError(`rewards: store "${storeHash}"`, error);

    return respond({ error: "Failed to load rewards." }, 500);
  }
}
