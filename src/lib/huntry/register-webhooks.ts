import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { getAbsoluteAppUrl } from "@/lib/routing/app-url";
import { logError } from "@/lib/errors/logger";

// docs/MIGRATION.md §4. store/order/created feeds redemption tracking
// (BC-HUN-041); store/cart/couponApplied feeds coupon-ownership enforcement
// (BC-HUN-049) — it fires only when a code is applied, so unlike
// store/cart/updated (still deliberately deferred: it fires on every cart
// change store-wide) its volume is small.
const ORDER_CREATED_SCOPE = "store/order/created";
const CART_COUPON_APPLIED_SCOPE = "store/cart/couponApplied";

interface HuntryWebhook {
  scope: string;
  path: string;
}

const HUNTRY_WEBHOOKS: HuntryWebhook[] = [
  { scope: ORDER_CREATED_SCOPE, path: "/api/webhooks/huntry/order" },
  { scope: CART_COUPON_APPLIED_SCOPE, path: "/api/webhooks/huntry/cart" },
];

interface BcWebhook {
  id: number;
  scope: string;
}

// Finds this app's own webhook for a scope among the store's existing ones,
// matched on scope — one row per scope is this app's own idempotency key (see
// store_webhooks' primary key), not name/destination.
async function findExistingWebhookId(restApiClient: BcRestApiClient, scope: string): Promise<string | undefined> {
  const result = await restApiClient.get<V3ListResponse<BcWebhook>>("/v3/hooks");

  const existing = result.data.data.find((hook) => hook.scope === scope);

  return existing ? String(existing.id) : undefined;
}

// Registers a webhook for a scope, adopting an existing one instead of
// creating a duplicate — safe to call more than once for the same store.
export async function findOrCreateWebhook(
  restApiClient: BcRestApiClient,
  scope: string,
  path: string,
): Promise<string> {
  const existingHookId = await findExistingWebhookId(restApiClient, scope);

  if (existingHookId) {
    return existingHookId;
  }

  const result = await restApiClient.post<{ data: BcWebhook }>("/v3/hooks", {
    body: {
      scope,
      destination: getAbsoluteAppUrl(undefined, path),
      is_active: true,
    },
  });

  return String(result.data.data.id);
}

export async function findOrCreateOrderWebhook(restApiClient: BcRestApiClient): Promise<string> {
  return findOrCreateWebhook(restApiClient, ORDER_CREATED_SCOPE, "/api/webhooks/huntry/order");
}

// Registers Huntry's webhooks for a newly installed store.
// Takes apiToken directly (the one just returned from the OAuth handshake)
// rather than looking it up, since the credentials store may not have it
// written yet — same reasoning as register-app-extension.ts's
// registerAppExtension.
//
// Deliberately never throws: a failed registration shouldn't block install.
// Logged rather than silently swallowed. Each scope is attempted on its own,
// so one failing (e.g. a token without the scope it needs) doesn't skip the
// rest. ensureWebhooks retries/backfills on app Load.
export async function registerWebhooks(storeHash: string, apiToken: string): Promise<void> {
  await registerMissingWebhooks(storeHash, apiToken, HUNTRY_WEBHOOKS);
}

async function registerMissingWebhooks(storeHash: string, apiToken: string, webhooks: HuntryWebhook[]): Promise<void> {
  for (const { scope, path } of webhooks) {
    try {
      const restApiClient = await getRestApiClient(storeHash, apiToken);
      const hookId = await findOrCreateWebhook(restApiClient, scope, path);

      await getCredentialsStore().setStoreWebhook({ storeHash, scope, hookId });
    } catch (error) {
      logError(`registerWebhooks: store "${storeHash}" scope "${scope}"`, error);
    }
  }
}

// Backfills stores installed before a webhook existed (and retries a failed
// install-time attempt), run after the Load response like
// provisionStorefrontPage. With every record already stored it makes no API
// call at all. Never throws.
export async function ensureWebhooks(storeHash: string): Promise<void> {
  try {
    const credentialsStore = getCredentialsStore();
    const missing: HuntryWebhook[] = [];

    for (const webhook of HUNTRY_WEBHOOKS) {
      if (!(await credentialsStore.getStoreWebhook(storeHash, webhook.scope))) {
        missing.push(webhook);
      }
    }

    if (missing.length === 0) {
      return;
    }

    const apiToken = await credentialsStore.getStoreToken(storeHash);

    if (!apiToken) {
      return;
    }

    await registerMissingWebhooks(storeHash, apiToken, missing);
  } catch (error) {
    logError(`ensureWebhooks: store "${storeHash}"`, error);
  }
}
