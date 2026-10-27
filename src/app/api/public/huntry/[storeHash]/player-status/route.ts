import { NextResponse } from "next/server";
import { z } from "zod";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { getPlayerStatus } from "@/lib/huntry/claims/player-status";
import { buildCorsHeaders, buildPreflightHeaders } from "@/lib/huntry/public-api/cors";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

const bodySchema = z.object({
  jwt: z.string().min(1),
  eventId: z.number().int().positive(),
});

// Same trust model as claims/route.ts: no bc_app_session, the signed customer
// JWT is the access control and CORS is defense-in-depth only. Read-only: tells
// the map page whether the hunt is closed to this customer (player cap reached
// and no claim yet), so a full hunt is blocked before the map loads.
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

    return respond(await getPlayerStatus(storeHash, body.data.eventId, auth.customerId), 200);
  } catch (error) {
    logError(`player-status: store "${storeHash}"`, error);

    return respond({ error: "Failed to check player status." }, 500);
  }
}
