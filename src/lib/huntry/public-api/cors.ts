import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { logError } from "@/lib/errors/logger";

// How long a store's resolved storefront origins are trusted. This is a plain
// in-process memo, deliberately NOT the app's CACHE_ENABLED-gated cache
// profiles: caching is opt-in there, and with it off every anonymous request
// to a public route would trigger a BigCommerce call. A changed domain is
// recognized once this expires (an accepted staleness window — see
// docs/MIGRATION.md §8).
const ORIGINS_TTL_MS = 10 * 60 * 1000;

// After a failed lookup, retry soon instead of hammering BigCommerce during an
// outage, without locking CORS out for the full TTL.
const FAILURE_TTL_MS = 30 * 1000;

const STORE_INFORMATION_PATH = "/v2/store";

// MOCK mode has no store to ask; the local dev origin keeps the route usable.
const MOCK_STOREFRONT_ORIGINS = ["http://localhost:3000"];

interface OriginsEntry {
  origins: string[];
  expiresAt: number;
}

const originsCache = new Map<string, OriginsEntry>();
const inFlightLookups = new Map<string, Promise<string[]>>();

// "https://Shop.example.com:443/path" -> "https://shop.example.com". Anything
// that isn't an http(s) URL (including the literal string "null" browsers send
// from sandboxed contexts) is not an origin.
export function toOrigin(value: string): string | null {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

// The fields of GET /v2/store this app reads. `domain` is a bare hostname (the
// store's primary domain, custom or *.mybigcommerce.com); `secure_url` is a
// full URL.
interface StoreInformation {
  domain?: string;
  secure_url?: string;
}

// Store Information (already covered by store_v2_information_read_only), not
// Channels + /v3/channels/{id}/site: that endpoint needs the separate
// "Sites & Routes" scope, which this app doesn't have (verified live: 403), and
// adding a scope forces every install to reauthorize. Known limitation: only
// the store's primary domain is recognized, so a multi-storefront merchant's
// additional channel domains aren't (docs/MIGRATION.md §8).
async function lookUpOrigins(storeHash: string): Promise<string[]> {
  const apiClient = await getRestApiClient(storeHash);
  const { data: store } = await apiClient.get<StoreInformation>(STORE_INFORMATION_PATH);
  const origins = new Set<string>();

  for (const candidate of [store.domain ? `https://${store.domain}` : null, store.secure_url ?? null]) {
    const origin = candidate ? toOrigin(candidate) : null;

    if (origin) {
      origins.add(origin);
    }
  }

  return [...origins];
}

async function loadOrigins(storeHash: string): Promise<string[]> {
  const previous = originsCache.get(storeHash);

  try {
    const origins = await lookUpOrigins(storeHash);

    originsCache.set(storeHash, { origins, expiresAt: Date.now() + ORIGINS_TTL_MS });

    return origins;
  } catch (error) {
    logError(`resolveStorefrontOrigins: store "${storeHash}"`, error);

    // Keep serving the last known origins through an outage; with none, fail
    // closed (no origin is recognized) rather than open.
    const origins = previous?.origins ?? [];

    originsCache.set(storeHash, { origins, expiresAt: Date.now() + FAILURE_TTL_MS });

    return origins;
  }
}

// The origins a store's storefront is served from (its primary domain,
// custom or *.mybigcommerce.com), from BigCommerce's Store Information API.
export async function resolveStorefrontOrigins(storeHash: string): Promise<string[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_STOREFRONT_ORIGINS;
  }

  const cached = originsCache.get(storeHash);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.origins;
  }

  const pending = inFlightLookups.get(storeHash);

  if (pending) {
    return pending;
  }

  const lookup = loadOrigins(storeHash).finally(() => inFlightLookups.delete(storeHash));

  inFlightLookups.set(storeHash, lookup);

  return lookup;
}

// For tests only.
export function resetStorefrontOriginsCache(): void {
  originsCache.clear();
  inFlightLookups.clear();
}

// CORS headers for a credential-less public read. ACAO is reflected only for
// an exact (scheme + host + port) match against the store's own storefront
// origins — never "*", and Access-Control-Allow-Credentials is deliberately
// never sent. This is defense-in-depth for browsers; it is not the trust
// boundary (the customer JWT is, for the mutating routes).
//
// A plain GET with no custom headers is a CORS "simple request", so no
// preflight/Allow-Methods/Allow-Headers are needed here; the POST claim route
// (BC-HUN-032) will add them.
export async function buildCorsHeaders(
  requestOrigin: string | null,
  storeHash: string,
): Promise<Record<string, string>> {
  // Vary on every response, so a shared cache never serves one origin's
  // answer to another.
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = requestOrigin ? toOrigin(requestOrigin) : null;

  // No/invalid Origin (curl, server-side callers, "null"): skip the lookup
  // entirely and send no ACAO.
  if (!origin) {
    return headers;
  }

  if ((await resolveStorefrontOrigins(storeHash)).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
