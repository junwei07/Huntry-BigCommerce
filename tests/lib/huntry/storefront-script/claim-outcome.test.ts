import { afterEach, describe, expect, it, vi } from "vitest";
import { submitClaim } from "@/lib/huntry/storefront-script/api";
import { toClaimOutcome } from "@/lib/huntry/storefront-script/claim-outcome";
import { loadFlag, persistFlag } from "@/lib/huntry/storefront-script/local-state";

describe("toClaimOutcome", () => {
  it.each([
    [200, { couponCode: "ABC" }, { kind: "claimed", couponCode: "ABC" }],
    [200, {}, { kind: "error" }],
    [401, { error: "Unauthorized." }, { kind: "guest" }],
    [403, { error: "too_far" }, { kind: "too-far" }],
    [404, { error: "egg_not_found" }, { kind: "not-found" }],
    [409, { error: "duplicate", couponCode: "MINE" }, { kind: "already-claimed-by-me", couponCode: "MINE" }],
    [409, { error: "duplicate" }, { kind: "error" }],
    [409, { error: "capacity_full" }, { kind: "full" }],
    [409, { error: "limit_reached" }, { kind: "limit-reached" }],
    [409, { error: "event_not_live" }, { kind: "not-live" }],
    [409, { error: "reward_unavailable" }, { kind: "unavailable" }],
    [429, { error: "rate_limited", retryAfterSeconds: 42 }, { kind: "rate-limited", retryAfterSeconds: 42 }],
    [429, { error: "cooldown" }, { kind: "slow-down" }],
    [429, { error: "too_fast" }, { kind: "slow-down" }],
    [502, { error: "code_issue_failed" }, { kind: "retry-later" }],
    [503, { error: "lock_timeout" }, { kind: "retry-later" }],
    [500, { error: "Failed to process claim." }, { kind: "error" }],
    [200, null, { kind: "error" }],
  ])("status %i %j -> %j", (status, body, expected) => {
    expect(toClaimOutcome(status, body)).toEqual(expected);
  });
});

describe("submitClaim", () => {
  const config = { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a fresh JWT, then posts it in the body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("jwt-token\n", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ couponCode: "ABC" }), { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    expect(await submitClaim(config, "egg-1", 1.5, 2.5)).toEqual({ kind: "claimed", couponCode: "ABC" });
    expect(fetchMock.mock.calls[0][0]).toBe("/customer/current.jwt?app_client_id=client-1");
    expect(fetchMock.mock.calls[1][0]).toBe("https://app.example.com/api/public/huntry/abc123/claims");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ jwt: "jwt-token", eggId: "egg-1", lat: 1.5, lng: 2.5 });
  });

  it("reports a guest (404 on current.jwt) without calling the claim route", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 404 }));

    vi.stubGlobal("fetch", fetchMock);

    expect(await submitClaim(config, "egg-1", 0, 0)).toEqual({ kind: "guest" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect(await submitClaim(config, "egg-1", 0, 0)).toEqual({ kind: "error" });
  });
});

describe("local-state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips ids through storage", () => {
    const store = new Map<string, string>();

    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });

    persistFlag("abc", 1, "skipped", new Set(["a", "b"]));

    expect([...loadFlag("abc", 1, "skipped")].sort()).toEqual(["a", "b"]);
    expect(loadFlag("abc", 2, "skipped").size).toBe(0);
  });

  it("falls back to empty / no-op when storage is missing or throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });

    expect(loadFlag("abc", 1, "mine").size).toBe(0);
    expect(() => persistFlag("abc", 1, "mine", new Set(["a"]))).not.toThrow();
  });
});
