import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "@/app/api/public/huntry/[storeHash]/player-status/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn() }));

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer", () => ({
  isAuthorizedForStorefrontCustomer: mocks.auth,
}));
vi.mock("@/lib/huntry/claims/player-status", () => ({ getPlayerStatus: mocks.status }));

const VALID = { jwt: "token", eventId: 7 };

function post(body: unknown, storeHash = "abc123") {
  return POST(
    new Request(`https://app.example.com/api/public/huntry/${storeHash}/player-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ storeHash }) },
  );
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  mocks.auth.mockReset().mockResolvedValue({ ok: true, customerId: 42 });
  mocks.status.mockReset().mockResolvedValue({ full: true });
});

afterEach(() => {
  delete process.env.DATA_MODE;
});

describe("POST player-status", () => {
  it("returns the status, never cached, using the customer id from the JWT", async () => {
    const response = await post(VALID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ full: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.status).toHaveBeenCalledWith("abc123", 7, 42);
  });

  it("rejects an invalid body with 400 before checking the JWT", async () => {
    expect((await post({ ...VALID, eventId: "7" })).status).toBe(400);
    expect((await post({ jwt: "token" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 for a bad or wrong-store token", async () => {
    mocks.auth.mockResolvedValue({ ok: false });

    expect((await post(VALID)).status).toBe(401);
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed store hash", async () => {
    expect((await post(VALID, "BAD HASH")).status).toBe(404);
  });

  it("returns 500 when the lookup fails", async () => {
    mocks.status.mockRejectedValue(new Error("db down"));

    expect((await post(VALID)).status).toBe(500);
  });
});

describe("OPTIONS player-status", () => {
  it("answers the preflight with 204", async () => {
    const response = await OPTIONS(
      new Request("https://app.example.com/api/public/huntry/abc123/player-status", { method: "OPTIONS" }),
      { params: Promise.resolve({ storeHash: "abc123" }) },
    );

    expect(response.status).toBe(204);
  });
});
