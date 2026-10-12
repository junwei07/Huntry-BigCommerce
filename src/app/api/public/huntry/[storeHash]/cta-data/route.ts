import { NextResponse } from "next/server";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { buildPublicCtaData } from "@/lib/huntry/public-api/cta-data";
import { buildCorsHeaders } from "@/lib/huntry/public-api/cors";

// Same store-hash rule as map-data/route.ts.
const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

// Same short shared-cache lifetime as map-data: the banner tolerates a few
// seconds of staleness, and this bounds the per-store queries when a CDN sits
// in front (this is fetched on every storefront page).
const CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=60";

// Public, unauthenticated read for the storefront header banner and product
// CTA (BC-HUN-038, docs/MIGRATION.md §4). Mirrors map-data/route.ts: never
// reads bc_app_session, CORS is defense-in-depth only, a plain GET needs no
// preflight, so there is deliberately no OPTIONS handler.
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
    const isKnownStore =
      STORE_HASH_PATTERN.test(storeHash) &&
      (getDataMode() !== "MULTITENANT" || Boolean(await getCredentialsStore().getStoreToken(storeHash)));

    if (!isKnownStore) {
      return NextResponse.json({ error: "Not found." }, { status: 404, headers: { ...cors, "Cache-Control": "no-store" } });
    }

    cors = await buildCorsHeaders(request.headers.get("origin"), storeHash);

    return NextResponse.json(await buildPublicCtaData(storeHash), {
      headers: { ...cors, "Cache-Control": CACHE_CONTROL },
    });
  } catch (error) {
    logError(`cta-data: store "${storeHash}"`, error);

    return NextResponse.json(
      { error: "Failed to load banner data." },
      { status: 500, headers: { ...cors, "Cache-Control": "no-store" } },
    );
  }
}
