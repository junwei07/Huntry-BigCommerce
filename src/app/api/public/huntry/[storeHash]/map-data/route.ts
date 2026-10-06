import { NextResponse } from "next/server";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { buildCorsHeaders } from "@/lib/huntry/public-api/cors";
import { buildPublicMapData } from "@/lib/huntry/public-api/map-data";

// BigCommerce store hashes are short lowercase alphanumerics; rejecting
// anything else up front keeps junk out of every downstream lookup.
const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;
const MAX_SLUG_LENGTH = 200;

// Short shared-cache lifetime: the map tolerates a few seconds of staleness
// (the claim route re-validates everything), and this bounds the uncached
// claim-count query when a CDN sits in front.
const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";

// Public, unauthenticated read for the storefront script (docs/MIGRATION.md
// §4): never reads bc_app_session, never calls isAuthorizedForStore. CORS is
// defense-in-depth only — see huntry/public-api/cors.ts. A plain GET needs no
// preflight, so there is deliberately no OPTIONS handler here.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;
  // Until the store is validated, only Vary is sent: CORS resolution calls
  // BigCommerce, and must never run (or be cached) for an arbitrary
  // attacker-chosen store hash.
  let cors: Record<string, string> = { Vary: "Origin" };

  try {
    // MOCK/STATIC have no per-store credentials row to check.
    const isKnownStore =
      STORE_HASH_PATTERN.test(storeHash) &&
      (getDataMode() !== "MULTITENANT" || Boolean(await getCredentialsStore().getStoreToken(storeHash)));

    if (!isKnownStore) {
      return NextResponse.json({ error: "Not found." }, { status: 404, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    cors = await buildCorsHeaders(request.headers.get("origin"), storeHash);

    const slug = new URL(request.url).searchParams.get("event")?.trim().slice(0, MAX_SLUG_LENGTH) || undefined;

    return NextResponse.json(await buildPublicMapData(storeHash, slug), {
      headers: { ...cors, "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    logError(`map-data: store "${storeHash}"`, error);

    return NextResponse.json(
      { error: "Failed to load map data." },
      { status: 500, headers: { ...cors, "Cache-Control": "no-store" } },
    );
  }
}
