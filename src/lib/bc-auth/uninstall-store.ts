import { parseStoreHash, verifySignedPayload } from "@/lib/bc-auth/verify-signed-payload";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";
import { removeStorefrontPage } from "@/lib/huntry/register-storefront-page";
import { deleteStoreImages } from "@/lib/huntry/storage/image-storage";

// Verifies the /uninstall callback's signed request and deletes everything
// stored for that store, rather than leaving stale rows behind. Every step is
// idempotent, so a failure part-way returns 500 and BigCommerce's retry
// resumes where it stopped.
export async function uninstallStore(signedPayloadJwt: string): Promise<void> {
  const payload = await verifySignedPayload(signedPayloadJwt);
  const storeHash = parseStoreHash(payload.sub);
  const credentialsStore = getCredentialsStore();

  // Must run before the tombstone and deleteStore: both make the token
  // unreadable, and this needs it. Best-effort and never throws: the token may
  // already be revoked, and a leftover page must not fail the uninstall.
  await removeStorefrontPage(storeHash);

  // From here the store reads as unknown (getStoreToken answers undefined), so
  // in-flight requests and webhooks can't write fresh data into a store we are
  // about to wipe. A reinstall clears it.
  await credentialsStore.markStoreUninstalled(storeHash);

  await deleteStoreImages(storeHash);
  await getHuntryRepository().storeData.deleteAllStoreData(storeHash);

  // Credentials last: the tombstone and token are what keep a retry coherent.
  await credentialsStore.deleteStore(storeHash);
}
