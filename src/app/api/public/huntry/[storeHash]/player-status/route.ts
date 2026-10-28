import { NextResponse } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/errors/logger";
import { getPlayerStatus } from "@/lib/huntry/claims/player-status";
import { buildCorsHeaders } from "@/lib/huntry/public-api/cors";
import { handlePublicPreflight, isKnownStore } from "@/lib/huntry/public-api/known-store";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const bodySchema = z.object({
  jwt: z.string().min(1),
  eventId: z.number().int().positive(),
});

// Same trust model as claims/route.ts: no bc_app_session, the signed customer
// JWT is the access control and CORS is defense-in-depth only. Read-only: tells
// the map page whether the hunt is closed to this customer (player cap reached
// and no claim yet), so a full hunt is blocked before the map loads.
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

    return respond(await getPlayerStatus(storeHash, body.data.eventId, auth.customerId), 200);
  } catch (error) {
    logError(`player-status: store "${storeHash}"`, error);

    return respond({ error: "Failed to check player status." }, 500);
  }
}
