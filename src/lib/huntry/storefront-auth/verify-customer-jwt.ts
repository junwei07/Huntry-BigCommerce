import { jwtVerify } from "jose";
import { z } from "zod";

// Claims of BigCommerce's `customer/current.jwt`, confirmed against a real
// token (docs/MIGRATION.md §5): signed HS512 with this app's client secret,
// iss "bc/apps", aud = this app's client id, ~15-minute TTL. Differently
// shaped from signed_payload_jwt (iss "bc", HS256) and the SSO-login JWT.
// jwtVerify already enforces signature/exp/iss/aud; this schema shapes what
// callers use. `operation` guards against any other BC token type signed
// with the same secret.
const customerJwtSchema = z.object({
  store_hash: z.string().min(1),
  operation: z.literal("current_customer"),
  customer: z.object({
    id: z.number().int().positive(),
    email: z.string().optional(),
    group_id: z.string().optional(),
  }),
});

export interface StorefrontCustomer {
  storeHash: string;
  customerId: number;
  email?: string;
}

// Verifies a customer/current.jwt and returns the customer identity. Throws
// jose's own error types on a bad/expired signature, or a ZodError on a shape
// mismatch — callers classify with isSignedPayloadVerificationError
// (src/lib/bc-auth/errors.ts), same as the admin verifier.
export async function verifyCustomerJwt(customerJwt: string): Promise<StorefrontCustomer> {
  const clientId = process.env.BIGCOMMERCE_CLIENT_ID;
  const clientSecret = process.env.BIGCOMMERCE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("BIGCOMMERCE_CLIENT_ID and BIGCOMMERCE_CLIENT_SECRET must be set to verify a storefront customer JWT.");
  }

  const { payload } = await jwtVerify(customerJwt, new TextEncoder().encode(clientSecret), {
    algorithms: ["HS512"],
    issuer: "bc/apps",
    audience: clientId,
  });
  const claims = customerJwtSchema.parse(payload);

  return { storeHash: claims.store_hash, customerId: claims.customer.id, email: claims.customer.email };
}
