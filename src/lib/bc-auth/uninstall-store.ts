import { parseStoreHash, verifySignedPayload } from "@/lib/bc-auth/verify-signed-payload";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { removeStorefrontPage } from "@/lib/huntry/register-storefront-page";

// Verifies the /uninstall callback's signed request and deletes everything
// stored for that store, rather than leaving stale rows behind.
export async function uninstallStore(signedPayloadJwt: string): Promise<void> {
  const payload = await verifySignedPayload(signedPayloadJwt);
  const storeHash = parseStoreHash(payload.sub);

  // Must run before deleteStore, which removes the token and the page record
  // it needs. Best-effort and never throws: the token may already be revoked,
  // and a leftover page must not fail the uninstall.
  await removeStorefrontPage(storeHash);

  await getCredentialsStore().deleteStore(storeHash);
}
