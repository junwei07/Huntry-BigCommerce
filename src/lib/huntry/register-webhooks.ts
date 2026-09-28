import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { getAbsoluteAppUrl } from "@/lib/routing/app-url";
import { logError } from "@/lib/errors/logger";

// The one webhook scope Week 1 registers — order-created, per
// docs/MIGRATION.md §4. store/cart/updated is deliberately deferred (fires
// on every cart change store-wide, needs its own filtering work to be
// worth its volume).
const ORDER_CREATED_SCOPE = "store/order/created";

interface BcWebhook {
  id: number;
  scope: string;
}

function getOrderWebhookDestination(): string {
  return getAbsoluteAppUrl(undefined, "/api/webhooks/huntry/order");
}

// Finds this app's own order-created webhook among the store's existing
// ones, matched on scope — one row per scope is this app's own idempotency
// key (see store_webhooks' primary key), not name/destination.
async function findExistingOrderWebhookId(restApiClient: BcRestApiClient): Promise<string | undefined> {
  const result = await restApiClient.get<V3ListResponse<BcWebhook>>("/v3/hooks");

  const existing = result.data.data.find((hook) => hook.scope === ORDER_CREATED_SCOPE);

  return existing ? String(existing.id) : undefined;
}

// Registers this app's order-created webhook, adopting an existing one
// instead of creating a duplicate — safe to call more than once for the
// same store.
export async function findOrCreateOrderWebhook(restApiClient: BcRestApiClient): Promise<string> {
  const existingHookId = await findExistingOrderWebhookId(restApiClient);

  if (existingHookId) {
    return existingHookId;
  }

  const result = await restApiClient.post<{ data: BcWebhook }>("/v3/hooks", {
    body: {
      scope: ORDER_CREATED_SCOPE,
      destination: getOrderWebhookDestination(),
      is_active: true,
    },
  });

  return String(result.data.data.id);
}

// Registers Huntry's order-created webhook for a newly installed store.
// Takes apiToken directly (the one just returned from the OAuth handshake)
// rather than looking it up, since the credentials store may not have it
// written yet — same reasoning as register-app-extension.ts's
// registerAppExtension.
//
// Deliberately never throws: a failed registration shouldn't block install.
// Logged rather than silently swallowed. A user-triggered retry action is
// Week 2 work (BC-HUN-011/012), once there's a Huntry admin page to host it.
export async function registerWebhooks(storeHash: string, apiToken: string): Promise<void> {
  try {
    const restApiClient = await getRestApiClient(storeHash, apiToken);
    const hookId = await findOrCreateOrderWebhook(restApiClient);

    await getCredentialsStore().setStoreWebhook({ storeHash, scope: ORDER_CREATED_SCOPE, hookId });
  } catch (error) {
    logError(`registerWebhooks: store "${storeHash}"`, error);
  }
}
