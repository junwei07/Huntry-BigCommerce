import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { getAbsoluteAppUrl } from "@/lib/routing/app-url";
import { logError } from "@/lib/errors/logger";

interface BcScript {
  uuid: string;
  api_client_id?: string;
  consent_category?: string;
  src?: string;
}

// essential, so the storefront script runs for every visitor. A functional
// script is held back by BigCommerce's cookie-consent manager until the shopper
// accepts the banner (it is injected as type="text/plain"), which left the Huntry
// page showing only its placeholder. The script only reads the public map-data,
// keeps per-event flags in localStorage and calls the claim route when the
// player acts; it sets no cookies and does no tracking. A deliberate product
// call — see docs/MIGRATION.md §7 (Open Risks).
export const STOREFRONT_SCRIPT_CONSENT_CATEGORY = "essential";

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
    consent_category: STOREFRONT_SCRIPT_CONSENT_CATEGORY,
  };
}

// Finds this app's own storefront script among the store's existing ones,
// matched on api_client_id (the field this app's own API credentials
// populate automatically, unlike name/url which could be renamed around) —
// see docs/MIGRATION.md §4.
async function findExistingStorefrontScript(restApiClient: BcRestApiClient): Promise<BcScript | undefined> {
  const result = await restApiClient.get<V3ListResponse<BcScript>>("/v3/content/scripts");

  return result.data.data.find((script) => script.api_client_id === process.env.BIGCOMMERCE_CLIENT_ID);
}

// A script registered earlier keeps whatever it was created with, so adopting
// it also brings it up to date: the consent category (it changed to essential)
// and the src, which embeds APP_ORIGIN and so goes stale whenever the app moves
// (a new dev tunnel, a new deployment). Only the fields that differ are sent. A
// failed update must not fail the adoption: the script still exists, it just
// keeps its old settings.
async function reconcileStorefrontScript(restApiClient: BcRestApiClient, script: BcScript, storeHash: string): Promise<void> {
  const changes: { consent_category?: string; src?: string } = {};
  const expectedSrc = getStorefrontScriptSrc(storeHash);

  if (script.consent_category !== STOREFRONT_SCRIPT_CONSENT_CATEGORY) {
    changes.consent_category = STOREFRONT_SCRIPT_CONSENT_CATEGORY;
  }

  if (script.src !== undefined && script.src !== expectedSrc) {
    changes.src = expectedSrc;
  }

  if (Object.keys(changes).length === 0) {
    return;
  }

  try {
    await restApiClient.put(`/v3/content/scripts/${script.uuid}`, { body: changes });
  } catch (error) {
    logError(`reconcileStorefrontScript: script "${script.uuid}"`, error);
  }
}

// Registers this app's storefront script, adopting an existing one instead
// of creating a duplicate — safe to call more than once for the same store.
export async function findOrCreateStorefrontScript(restApiClient: BcRestApiClient, storeHash: string): Promise<string> {
  const existingScript = await findExistingStorefrontScript(restApiClient);

  if (existingScript) {
    await reconcileStorefrontScript(restApiClient, existingScript, storeHash);

    return existingScript.uuid;
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
