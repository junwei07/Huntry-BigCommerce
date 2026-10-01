import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "@/lib/session/session-jwt";
import { SessionPayload } from "@/lib/session/types";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
});

describe("signSession / verifySession", () => {
  it("round-trips a payload", async () => {
    const payload: SessionPayload = {
      userId: 42,
      authenticatedStores: ["store-a", "store-b"],
      issuedAt: Math.floor(Date.now() / 1000),
    };

    const jwt = await signSession(payload);
    const verified = await verifySession(jwt);

    expect(verified).toEqual(payload);
  });

  it("throws on a tampered token", async () => {
    const jwt = await signSession({
      userId: 1,
      authenticatedStores: ["store-a"],
      issuedAt: Math.floor(Date.now() / 1000),
    });

    const tampered = `${jwt.slice(0, -4)}abcd`;

    await expect(verifySession(tampered)).rejects.toThrow();
  });

  it("throws once issuedAt exceeds SESSION_MAX_AGE_SECONDS", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 10;
    const jwt = await signSession({ userId: 1, authenticatedStores: ["store-a"], issuedAt });

    await expect(verifySession(jwt)).rejects.toThrow("Session exceeded its maximum age.");
  });
});
