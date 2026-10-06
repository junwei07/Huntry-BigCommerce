import { isSignedPayloadVerificationError } from "@/lib/bc-auth/errors";
import { verifyCustomerJwt } from "@/lib/huntry/storefront-auth/verify-customer-jwt";

export type StorefrontCustomerAuthResult = { ok: true; customerId: number } | { ok: false };

// Deliberately stateless, unlike isAuthorizedForStore: no session cookie, no
// isStoreUserLinked DB check — the JWT signature is the proof, and its short
// TTL is the only defense against staleness (docs/MIGRATION.md §5). The
// store-binding check is the security-critical part: without it a token
// minted for store A would pass on store B's routes.
//
// A bad/expired/malformed token is `{ ok: false }`; anything else (missing
// BIGCOMMERCE_CLIENT_SECRET) propagates so callers return a 500, not a
// misleading 401.
export async function isAuthorizedForStorefrontCustomer(
  customerJwt: string | undefined,
  storeHash: string,
): Promise<StorefrontCustomerAuthResult> {
  if (!customerJwt) {
    return { ok: false };
  }

  try {
    const customer = await verifyCustomerJwt(customerJwt);

    return customer.storeHash === storeHash ? { ok: true, customerId: customer.customerId } : { ok: false };
  } catch (error) {
    if (isSignedPayloadVerificationError(error)) {
      return { ok: false };
    }

    throw error;
  }
}
