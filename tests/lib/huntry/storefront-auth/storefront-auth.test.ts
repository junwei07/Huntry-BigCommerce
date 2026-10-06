import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";
import { verifyCustomerJwt } from "@/lib/huntry/storefront-auth/verify-customer-jwt";

const SECRET = "test-client-secret";
const CLIENT_ID = "test-client-id";

// Mirrors the claim shape of a real customer/current.jwt (HS512, iss
// "bc/apps", aud = client id) — fixtures only, not a real token.
function sign(
  claims: Record<string, unknown>,
  { secret = SECRET, exp = "5m", alg = "HS512", iss = "bc/apps", aud = CLIENT_ID } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg, typ: "JWT" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

const validClaims = {
  store_hash: "abc123",
  operation: "current_customer",
  customer: { id: 42, email: "a@b.com", group_id: "0" },
};

let originalSecret: string | undefined;
let originalClientId: string | undefined;

beforeEach(() => {
  originalSecret = process.env.BIGCOMMERCE_CLIENT_SECRET;
  originalClientId = process.env.BIGCOMMERCE_CLIENT_ID;
  process.env.BIGCOMMERCE_CLIENT_SECRET = SECRET;
  process.env.BIGCOMMERCE_CLIENT_ID = CLIENT_ID;
});

afterEach(() => {
  for (const [key, value] of [
    ["BIGCOMMERCE_CLIENT_SECRET", originalSecret],
    ["BIGCOMMERCE_CLIENT_ID", originalClientId],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("verifyCustomerJwt", () => {
  it("returns the customer identity for a valid token", async () => {
    expect(await verifyCustomerJwt(await sign(validClaims))).toEqual({
      storeHash: "abc123",
      customerId: 42,
      email: "a@b.com",
    });
  });

  it("rejects a token signed with the wrong secret", async () => {
    await expect(verifyCustomerJwt(await sign(validClaims, { secret: "other" }))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    await expect(verifyCustomerJwt(await sign(validClaims, { exp: "-1m" }))).rejects.toThrow();
  });

  it("rejects an HS256-signed token (BigCommerce signs HS512)", async () => {
    await expect(verifyCustomerJwt(await sign(validClaims, { alg: "HS256" }))).rejects.toThrow();
  });

  it("rejects the wrong issuer", async () => {
    await expect(verifyCustomerJwt(await sign(validClaims, { iss: "bc" }))).rejects.toThrow();
  });

  it("rejects a token minted for a different app (audience)", async () => {
    await expect(verifyCustomerJwt(await sign(validClaims, { aud: "other-app" }))).rejects.toThrow();
  });

  it("rejects a different token operation", async () => {
    await expect(verifyCustomerJwt(await sign({ ...validClaims, operation: "something_else" }))).rejects.toThrow();
  });

  it("rejects a token missing the customer claim", async () => {
    await expect(
      verifyCustomerJwt(await sign({ store_hash: "abc123", operation: "current_customer" })),
    ).rejects.toThrow();
  });

  it("throws when the client secret or id is not configured", async () => {
    const jwt = await sign(validClaims);

    delete process.env.BIGCOMMERCE_CLIENT_SECRET;
    await expect(verifyCustomerJwt(jwt)).rejects.toThrow(/BIGCOMMERCE_CLIENT_SECRET/);

    process.env.BIGCOMMERCE_CLIENT_SECRET = SECRET;
    delete process.env.BIGCOMMERCE_CLIENT_ID;
    await expect(verifyCustomerJwt(jwt)).rejects.toThrow(/BIGCOMMERCE_CLIENT_ID/);
  });
});

describe("isAuthorizedForStorefrontCustomer", () => {
  it("authorizes a valid token for its own store", async () => {
    expect(await isAuthorizedForStorefrontCustomer(await sign(validClaims), "abc123")).toEqual({
      ok: true,
      customerId: 42,
    });
  });

  it("rejects a token minted for a different store", async () => {
    expect(await isAuthorizedForStorefrontCustomer(await sign(validClaims), "other")).toEqual({ ok: false });
  });

  it("returns ok:false for missing, garbage, forged, and malformed tokens", async () => {
    expect(await isAuthorizedForStorefrontCustomer(undefined, "abc123")).toEqual({ ok: false });
    expect(await isAuthorizedForStorefrontCustomer("not-a-jwt", "abc123")).toEqual({ ok: false });
    expect(await isAuthorizedForStorefrontCustomer(await sign(validClaims, { secret: "x" }), "abc123")).toEqual({
      ok: false,
    });
    expect(
      await isAuthorizedForStorefrontCustomer(
        await sign({ store_hash: "abc123", operation: "current_customer" }),
        "abc123",
      ),
    ).toEqual({ ok: false });
  });

  it("propagates a missing-secret misconfiguration instead of returning ok:false", async () => {
    const jwt = await sign(validClaims);

    delete process.env.BIGCOMMERCE_CLIENT_SECRET;

    await expect(isAuthorizedForStorefrontCustomer(jwt, "abc123")).rejects.toThrow(/BIGCOMMERCE_CLIENT_SECRET/);
  });
});
