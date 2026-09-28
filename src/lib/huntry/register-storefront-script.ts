import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { getAbsoluteAppUrl } from "@/lib/routing/app-url";
import { logError } from "@/lib/errors/logger";

interface BcScript {
  uuid: string;
  api_client_id?: string;
}

// The scaffold placeholder route this week — BC-HUN-034 replaces its
// content with the real bundle, at this same URL.
function getStorefrontScriptSrc(storeHash: string): string {
  // storeHash argument is undefined so getAppUrl doesn't also prefix this
  // with /store/<hash> — this route lives outside that segment (it's a
  // public, unauthenticated route the storefront's own browser fetches).
  return getAbsoluteAppUrl(undefined, `/api/public/huntry/${storeHash}/storefront-script.js`);
}

function buildScriptInput(storeHash: string) {
  return {
    name: "Huntry",
    description: "Loads the Huntry treasure-hunt storefront experience.",
    kind: "src",
    src: getStorefrontScriptSrc(storeHash),
    auto_uninstall: true,
    load_method: "defer",
    location: "footer",
    visibility: "storefront",
    // functional (not essential) is a deliberate, revisitable product
    // call — see docs/MIGRATION.md §8: essential guarantees the script
    // always runs even under cookie-consent suppression, functional can be
    // blocked by a privacy-conscious visitor's consent choice.
    consent_category: "functional",
  };
}

// Finds this app's own storefront script among the store's existing ones,
// matched on api_client_id (the field this app's own API credentials
// populate automatically, unlike name/url which could be renamed around) —
// see docs/MIGRATION.md §4.
async function findExistingStorefrontScriptId(restApiClient: BcRestApiClient): Promise<string | undefined> {
  const result = await restApiClient.get<V3ListResponse<BcScript>>("/v3/content/scripts");

  return result.data.data.find((script) => script.api_client_id === process.env.BIGCOMMERCE_CLIENT_ID)?.uuid;
}

// Registers this app's storefront script, adopting an existing one instead
// of creating a duplicate — safe to call more than once for the same store.
export async function findOrCreateStorefrontScript(restApiClient: BcRestApiClient, storeHash: string): Promise<string> {
  const existingScriptId = await findExistingStorefrontScriptId(restApiClient);

  if (existingScriptId) {
    return existingScriptId;
  }

  const result = await restApiClient.post<{ data: BcScript }>("/v3/content/scripts", {
    body: buildScriptInput(storeHash),
  });

  return result.data.data.uuid;
}

// Registers the Huntry storefront script for a newly installed store. Takes
// apiToken directly (the one just returned from the OAuth handshake) rather
// than looking it up, since the credentials store may not have it written
// yet — same reasoning as register-app-extension.ts's registerAppExtension.
//
// Deliberately never throws: a failed registration shouldn't block install.
// Logged rather than silently swallowed. A user-triggered retry action is
// Week 2 work (BC-HUN-011/012), once there's a Huntry admin page to host it.
export async function registerStorefrontScript(storeHash: string, apiToken: string): Promise<void> {
  try {
    const restApiClient = await getRestApiClient(storeHash, apiToken);
    const scriptId = await findOrCreateStorefrontScript(restApiClient, storeHash);

    await getCredentialsStore().setStoreStorefrontScript({ storeHash, scriptId });
  } catch (error) {
    logError(`registerStorefrontScript: store "${storeHash}"`, error);
  }
}
