import { afterEach, describe, expect, it, vi } from "vitest";
import { isCheckoutArea, isCheckoutPage, startCheckoutGuard } from "@/lib/huntry/storefront-script/checkout-guard";
import {
  couponFromRequest,
  observeCouponRequests,
  ObserverTarget,
} from "@/lib/huntry/storefront-script/coupon-request-observer";

const config = { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" };
const APPLY = "/api/storefront/checkouts/7a1c/coupons";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isCheckoutPage / isCheckoutArea", () => {
  it("separates the checkout from the order confirmation under it", () => {
    expect(isCheckoutPage("/checkout")).toBe(true);
    expect(isCheckoutPage("/checkout/")).toBe(true);
    expect(isCheckoutPage("/checkout/order-confirmation/123")).toBe(false);
    expect(isCheckoutArea("/checkout")).toBe(true);
    expect(isCheckoutArea("/checkout/order-confirmation/123")).toBe(true);
    expect(isCheckoutArea("/cart.php")).toBe(false);
    expect(isCheckoutArea("/checkouts-and-more/")).toBe(false);
    expect(isCheckoutArea("/huntry/")).toBe(false);
  });
});

describe("couponFromRequest", () => {
  it("reads the typed code from a coupon-apply POST", () => {
    expect(couponFromRequest("POST", APPLY, JSON.stringify({ couponCode: "  HUNT-AAAA1111 " }))).toBe("HUNT-AAAA1111");
    expect(couponFromRequest("post", `${APPLY}?include=cart`, JSON.stringify({ couponCode: "A" }))).toBe("A");
    expect(couponFromRequest("POST", "/api/storefront/carts/7a1c/coupons", JSON.stringify({ couponCode: "A" }))).toBe("A");
  });

  it("ignores any other request", () => {
    const body = JSON.stringify({ couponCode: "A" });

    expect(couponFromRequest("GET", APPLY, body)).toBeNull();
    expect(couponFromRequest("DELETE", `${APPLY}/A`, body)).toBeNull();
    expect(couponFromRequest("POST", "/api/storefront/checkouts/7a1c/billing-address", body)).toBeNull();
    expect(couponFromRequest("POST", APPLY, "not json")).toBeNull();
    expect(couponFromRequest("POST", APPLY, JSON.stringify({ couponCode: "  " }))).toBeNull();
    expect(couponFromRequest("POST", APPLY, JSON.stringify({ other: 1 }))).toBeNull();
    expect(couponFromRequest("POST", APPLY, undefined)).toBeNull();
  });
});

// A stand-in XMLHttpRequest that records calls and can fire its events.
function fakeXhrClass() {
  class FakeXhr {
    static opened: unknown[][] = [];
    static sent: unknown[] = [];

    listeners = new Map<string, () => void>();

    open(...args: unknown[]) {
      FakeXhr.opened.push(args);
    }

    send(body?: unknown) {
      FakeXhr.sent.push(body);
    }

    addEventListener(name: string, listener: () => void) {
      this.listeners.set(name, listener);
    }

    finish() {
      this.listeners.get("loadend")?.();
    }
  }

  return FakeXhr;
}

describe("observeCouponRequests (XHR)", () => {
  it("reports a coupon apply after it finishes, and passes the call through unchanged", () => {
    const Xhr = fakeXhrClass();
    const target = { XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest };
    const onApplied = vi.fn();

    observeCouponRequests(onApplied, target);

    const request = new Xhr();
    const body = JSON.stringify({ couponCode: "HUNT-AAAA1111" });

    request.open("POST", APPLY, true);
    request.send(body);

    expect(Xhr.opened).toEqual([["POST", APPLY, true]]);
    expect(Xhr.sent).toEqual([body]);
    expect(onApplied).not.toHaveBeenCalled();

    request.finish();

    expect(onApplied).toHaveBeenCalledExactlyOnceWith("HUNT-AAAA1111");
  });

  it("ignores other requests", () => {
    const Xhr = fakeXhrClass();
    const onApplied = vi.fn();

    observeCouponRequests(onApplied, { XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest });

    const request = new Xhr();

    request.open("GET", "/api/storefront/checkouts/7a1c", true);
    request.send();
    request.finish();

    expect(onApplied).not.toHaveBeenCalled();
    expect(Xhr.sent).toEqual([undefined]);
  });

  it("never lets a throwing callback reach the page", () => {
    const Xhr = fakeXhrClass();

    observeCouponRequests(
      () => {
        throw new Error("boom");
      },
      { XMLHttpRequest: Xhr as unknown as typeof XMLHttpRequest },
    );

    const request = new Xhr();

    request.open("POST", APPLY, true);
    request.send(JSON.stringify({ couponCode: "A" }));

    expect(() => request.finish()).not.toThrow();
  });
});

describe("observeCouponRequests (fetch)", () => {
  it("reports a coupon apply once the response arrives, whatever its status, and returns the original promise result", async () => {
    const response = new Response("{}", { status: 422 });
    const originalFetch = vi.fn(async () => response);
    const target: ObserverTarget = { fetch: originalFetch as unknown as typeof fetch };
    const onApplied = vi.fn();

    observeCouponRequests(onApplied, target);

    const init = { method: "POST", body: JSON.stringify({ couponCode: "HUNT-AAAA1111" }) };
    const result = await target.fetch!(APPLY, init);

    expect(result).toBe(response);
    expect(originalFetch).toHaveBeenCalledExactlyOnceWith(APPLY, init);
    expect(onApplied).toHaveBeenCalledExactlyOnceWith("HUNT-AAAA1111");
  });

  it("skips a request that fails without a response, and other requests", async () => {
    const originalFetch = vi.fn(async (url: string) => {
      if (url === APPLY) throw new Error("offline");

      return new Response("{}");
    });
    const target: ObserverTarget = { fetch: originalFetch as unknown as typeof fetch };
    const onApplied = vi.fn();

    observeCouponRequests(onApplied, target);

    await expect(target.fetch!(APPLY, { method: "POST", body: JSON.stringify({ couponCode: "A" }) })).rejects.toThrow("offline");
    await target.fetch!("/api/storefront/checkouts/7a1c", { method: "GET" });

    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("startCheckoutGuard", () => {
  it("runs one check for an applied code and reloads when it is someone else's", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });

    const originalFetch = vi.fn(async () => new Response("{}"));
    const target: ObserverTarget = { fetch: originalFetch as unknown as typeof fetch };
    const foreignCodes = vi.fn(async () => ["THEIRS"]);
    const reload = vi.fn();
    const cartFetch = vi.fn(async () => new Response(JSON.stringify([{ id: "cart-1", coupons: [] }])));

    startCheckoutGuard(config, { foreignCodes, reload, fetchImpl: cartFetch as never }, target);
    await target.fetch!(APPLY, { method: "POST", body: JSON.stringify({ couponCode: "THEIRS" }) });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    expect(foreignCodes).toHaveBeenCalledExactlyOnceWith(config, ["THEIRS"]);
  });

  it("does nothing for a code that is fine", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });

    const target: ObserverTarget = { fetch: vi.fn(async () => new Response("{}")) as unknown as typeof fetch };
    const foreignCodes = vi.fn(async () => []);
    const reload = vi.fn();

    startCheckoutGuard(config, { foreignCodes, reload }, target);
    await target.fetch!(APPLY, { method: "POST", body: JSON.stringify({ couponCode: "SUMMER10" }) });
    await vi.waitFor(() => expect(foreignCodes).toHaveBeenCalledTimes(1));

    expect(reload).not.toHaveBeenCalled();
  });
});
