import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { eventClaimsTag } from "@/lib/huntry/claims/cache-tags";
import { checkClaimRateLimit } from "@/lib/huntry/claims/claim-rate-limit";
import { createPlayerClaim } from "@/lib/huntry/claims/player-claim";
import { CreatePlayerClaimResult } from "@/lib/huntry/claims/types";
import { buildCorsHeaders, buildPreflightHeaders } from "@/lib/huntry/public-api/cors";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

const claimBodySchema = z.object({
  jwt: z.string().min(1),
  eggId: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// How each refusal reaches the storefront script. The JWT is the access
// control; the cooldown/speed pair is only a replay deterrent
// (docs/MIGRATION.md §7). The BC-HUN-033 sliding window (claim-rate-limit.ts)
// runs before this and answers `rate_limited` with its own 429 body.
const STATUS_BY_RESULT: Record<Exclude<CreatePlayerClaimResult["status"], "created">, number> = {
  egg_not_found: 404,
  too_far: 403,
  duplicate: 409,
  capacity_full: 409,
  player_limit_reached: 409,
  limit_reached: 409,
  event_not_live: 409,
  reward_unavailable: 409,
  cooldown: 429,
  too_fast: 429,
  code_issue_failed: 502,
  lock_timeout: 503,
  claim_in_progress: 503,
};

// Public, unauthenticated-by-cookie route (docs/MIGRATION.md §4): never reads
// bc_app_session and never calls isAuthorizedForStore. Trust comes from the
// signed customer JWT; CORS is defense-in-depth only.
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

  // CORS resolution calls BigCommerce, so it only runs for a known store.
  const headers = (await isKnownStore(storeHash))
    ? await buildPreflightHeaders(request.headers.get("origin"), storeHash)
    : { Vary: "Origin" };

  return new NextResponse(null, { status: 204, headers });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;
  let cors: Record<string, string> = { Vary: "Origin" };
  const respond = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
    NextResponse.json(body, { status, headers: { ...cors, ...extraHeaders, "Cache-Control": "no-store" } });

  try {
    if (!(await isKnownStore(storeHash))) {
      return respond({ error: "Not found." }, 404);
    }

    cors = await buildCorsHeaders(request.headers.get("origin"), storeHash);

    const body = claimBodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return respond({ error: "Invalid request." }, 400);
    }

    const auth = await isAuthorizedForStorefrontCustomer(body.data.jwt, storeHash);

    if (!auth.ok) {
      return respond({ error: "Unauthorized." }, 401);
    }

    const limit = await checkClaimRateLimit(storeHash, auth.customerId, body.data.eggId);

    if (limit.limited) {
      return respond({ error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds }, 429, {
        "Retry-After": String(limit.retryAfterSeconds),
      });
    }

    const result = await createPlayerClaim(
      { eggId: body.data.eggId, bcCustomerId: auth.customerId, lat: body.data.lat, lng: body.data.lng },
      storeHash,
    );

    if (result.status === "created") {
      // The admin Map tab's egg panel and hover popup are cached per event;
      // expire them so this claim shows up. Never fails the claim itself.
      try {
        revalidateTag(eventClaimsTag(result.claim.eventId), { expire: 0 });
      } catch (error) {
        logError(`claims: store "${storeHash}" cache revalidation`, error);
      }

      return respond({ couponCode: result.claim.couponCode }, 200);
    }

    // A duplicate hands back the customer's own existing code so the found-egg
    // state can re-show it.
    return respond(
      { error: result.status, ...(result.status === "duplicate" ? { couponCode: result.couponCode } : {}) },
      STATUS_BY_RESULT[result.status],
    );
  } catch (error) {
    logError(`claims: store "${storeHash}"`, error);

    return respond({ error: "Failed to process claim." }, 500);
  }
}
