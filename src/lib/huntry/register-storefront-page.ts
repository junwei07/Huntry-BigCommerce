import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { BcRestApiClient, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";

// The storefront "Huntry tab": a real BigCommerce content page that holds the
// container the storefront script (src/lib/huntry/storefront-script/) renders
// into, the counterpart of the WordPress plugin's [huntry_map] page
// (huntry/includes/frontend/map.php, huntry_create_frontend_page). Stencil has
// no rewrite rules, so events are selected with ?event=<slug> on this one URL.
export const STOREFRONT_PAGE_URL = "/huntry/";

// An attribute rather than an HTML comment: page bodies can be sanitised and
// comments stripped, while data-* attributes survive (checked live against the
// Pages API). It is how we recognise a page we created.
const MANAGED_MARKER = "data-huntry-managed";

export const STOREFRONT_PAGE_BODY =
  `<div id="huntry-map" data-huntry-map ${MANAGED_MARKER}="1">` +
  "This page needs scripts enabled to show Huntry." +
  "</div>";

const PAGE_LIST_LIMIT = 250;

interface BcPage {
  id: number;
  url: string;
  body?: string;
}

export interface ProvisionedPage {
  pageId: number;
  createdByApp: boolean;
}

// The default page size is 50, so a store with many pages could hide ours and
// trigger a pointless create; follow the pagination instead.
async function findPageByUrl(restApiClient: BcRestApiClient): Promise<number | undefined> {
  let page = 1;
  let totalPages = 1;

  do {
    const result = await restApiClient.get<V3ListResponse<BcPage>>("/v3/content/pages", {
      params: { limit: PAGE_LIST_LIMIT, page },
    });
    const match = result.data.data.find((item) => item.url === STOREFRONT_PAGE_URL);

    if (match) {
      return match.id;
    }

    totalPages = result.data.meta?.pagination?.total_pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return undefined;
}

async function hasManagedMarker(restApiClient: BcRestApiClient, pageId: number): Promise<boolean> {
  const result = await restApiClient.get<{ data: BcPage }>(`/v3/content/pages/${pageId}`, {
    params: { include: "body" },
  });

  return Boolean(result.data.data.body?.includes(MANAGED_MARKER));
}

async function adoptExistingPage(restApiClient: BcRestApiClient, pageId: number): Promise<ProvisionedPage> {
  const createdByApp = await hasManagedMarker(restApiClient, pageId);

  if (!createdByApp) {
    // A merchant's own /huntry/ page. Never edited or deleted by this app; the
    // storefront script finds no container there, so nothing renders.
    logError(
      "findOrCreateStorefrontPage",
      new Error(`A page already exists at ${STOREFRONT_PAGE_URL} (id ${pageId}) and is not managed by Huntry; leaving it alone.`),
    );
  }

  return { pageId, createdByApp };
}

// Creates the Huntry page, adopting an existing one instead of duplicating it.
// An existing page is never overwritten: the merchant may have edited or hidden
// it. Safe to call more than once and concurrently (install and an app load can
// overlap): BigCommerce rejects a duplicate URL, so a failed create re-lists
// once and adopts the page the other call made.
export async function findOrCreateStorefrontPage(restApiClient: BcRestApiClient): Promise<ProvisionedPage> {
  const existingId = await findPageByUrl(restApiClient);

  if (existingId !== undefined) {
    return adoptExistingPage(restApiClient, existingId);
  }

  try {
    const result = await restApiClient.post<{ data: BcPage }>("/v3/content/pages", {
      body: {
        type: "page",
        name: "Huntry",
        url: STOREFRONT_PAGE_URL,
        is_visible: true,
        body: STOREFRONT_PAGE_BODY,
        meta_title: "Huntry",
      },
    });

    return { pageId: result.data.data.id, createdByApp: true };
  } catch (error) {
    const racedId = await findPageByUrl(restApiClient);

    if (racedId === undefined) {
      throw error;
    }

    return adoptExistingPage(restApiClient, racedId);
  }
}

// Provisions the Huntry page once per store and remembers it
// (store_storefront_pages). With a record present this makes no API call, and a
// page the merchant later deleted is deliberately not recreated. A failed
// attempt writes no record, so the next app load retries.
//
// Called from install (apiToken = the one just returned by the OAuth
// handshake, which the credentials store may not hold yet) and from the app
// load callback (no token: resolved from the credentials store). Only runs in
// MULTITENANT mode: the other modes have no per-store install to provision, and
// the mock client rejects writes.
//
// Deliberately never throws: a failed provision must not block install or the
// admin from opening. Logged rather than silently swallowed.
export async function provisionStorefrontPage(storeHash: string, apiToken?: string): Promise<void> {
  if (getDataMode() !== "MULTITENANT") {
    return;
  }

  try {
    const credentialsStore = getCredentialsStore();

    if (await credentialsStore.getStoreStorefrontPage(storeHash)) {
      return;
    }

    const restApiClient = await getRestApiClient(storeHash, apiToken);
    const { pageId, createdByApp } = await findOrCreateStorefrontPage(restApiClient);

    await credentialsStore.setStoreStorefrontPage({ storeHash, pageId, createdByApp });
  } catch (error) {
    logError(`provisionStorefrontPage: store "${storeHash}"`, error);
  }
}

// Best-effort removal of the page we created, for the uninstall callback. Takes
// the page record (read before the store row is deleted) and deletes by its
// recorded id, so a lookalike or merchant-owned page is never touched. The
// access token may already be revoked by the time uninstall fires; then the
// empty page is accepted residue (like Customer Groups and Promotions, see
// docs/MIGRATION.md §4).
export async function removeStorefrontPage(storeHash: string): Promise<void> {
  if (getDataMode() !== "MULTITENANT") {
    return;
  }

  try {
    const record = await getCredentialsStore().getStoreStorefrontPage(storeHash);

    if (!record?.createdByApp) {
      return;
    }

    const restApiClient = await getRestApiClient(storeHash);

    await restApiClient.delete(`/v3/content/pages/${record.pageId}`);
  } catch (error) {
    logError(`removeStorefrontPage: store "${storeHash}"`, error);
  }
}
