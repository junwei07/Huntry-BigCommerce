import { NextResponse } from "next/server";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { buildPreflightHeaders } from "@/lib/huntry/public-api/cors";

// BigCommerce store hashes are short lowercase alphanumerics; rejecting
// anything else up front keeps junk out of every downstream lookup. This is
// deliberately stricter than src/lib/firebase/store-hash.ts (which also allows
// uppercase, "_" and "-" up to 64 chars for Firestore ids): the public routes
// must not widen what they accept, so do not merge the two.
const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

// The gate every public (cookie-less) route runs first, so CORS resolution —
// which calls BigCommerce — and any data lookup never run for an arbitrary
// attacker-chosen store hash. MOCK/STATIC have no per-store credentials row to
// check.
export async function isKnownStore(storeHash: string): Promise<boolean> {
  return (
    STORE_HASH_PATTERN.test(storeHash) &&
    (getDataMode() !== "MULTITENANT" || Boolean(await getCredentialsStore().getStoreToken(storeHash)))
  );
}

// The OPTIONS handler shared by the public POST routes. Only a known store gets
// real preflight headers; anything else gets a bare 204 with `Vary: Origin`.
export async function handlePublicPreflight(request: Request, storeHash: string): Promise<NextResponse> {
  const headers = (await isKnownStore(storeHash))
    ? await buildPreflightHeaders(request.headers.get("origin"), storeHash)
    : { Vary: "Origin" };

  return new NextResponse(null, { status: 204, headers });
}
