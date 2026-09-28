import { cache } from "react";
import { MockRestApiClient } from "@/lib/bc-api-client/rest-client/mock-rest-client/mock-rest-client";
import { getDataMode, resolveApiToken, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { RestApiClient } from "@/lib/bc-api-client/rest-client/rest-client";
import { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

// Memoized per request, keyed on the resolved store hash (not the raw route
// param) — e.g. in STATIC mode every call resolves to the same store
// regardless of route param, and should share one instance per request.
const getCachedRestApiClient = cache(async (resolvedStoreHash: string | undefined): Promise<BcRestApiClient> => {
  return new RestApiClient({ storeHash: resolvedStoreHash, apiToken: await resolveApiToken(resolvedStoreHash) });
});

// Selects and configures the BigCommerce REST API client for the given
// store. Takes the [storeHash] route param (or undefined on a root-level
// dev route) and resolves internally which store to actually target, since
// that isn't always the same thing (e.g. STATIC mode always targets its one
// env-configured store).
//
// apiToken is an explicit override, mirroring getGraphqlApiClient's own —
// needed by callers like register-storefront-script.ts/register-webhooks.ts
// that run right after the OAuth handshake, where the token may not be
// written to the credentials store yet. Passing it skips resolveApiToken
// and the shared cache, since this client is a one-off for a single call.
export async function getRestApiClient(storeHash: string | undefined, apiToken?: string): Promise<BcRestApiClient> {
  if (apiToken !== undefined) {
    return new RestApiClient({ storeHash, apiToken });
  }

  if (getDataMode() === "MOCK") {
    return new MockRestApiClient();
  }

  return getCachedRestApiClient(resolveStoreHash(storeHash));
}
