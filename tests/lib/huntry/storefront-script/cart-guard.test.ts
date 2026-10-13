import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkSubmittedCode,
  couponFromForm,
  isCartPage,
  onCouponSubmitted,
  readCartCoupons,
  removeCartCoupon,
} from "@/lib/huntry/storefront-script/cart-guard";

const config = { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const cartBody = (codes: string[]) => [{ id: "cart-1", coupons: codes.map((code) => ({ code })) }];

// A Map-backed sessionStorage: the node test environment has none.
function stubSessionStorage() {
  const store = new Map<string, string>();

  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });

  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isCartPage", () => {
  it("matches the cart page only", () => {
    expect(isCartPage("/cart.php")).toBe(true);
    expect(isCartPage("/cart")).toBe(true);
    expect(isCartPage("/cart/")).toBe(true);
    expect(isCartPage("/huntry/")).toBe(false);
    expect(isCartPage("/checkout")).toBe(false);
    expect(isCartPage("/cartridges/")).toBe(false);
  });
});

describe("readCartCoupons", () => {
  it("reads the cart id and coupon codes", async () => {
    const fetchImpl = vi.fn(async () => response(cartBody(["A", "B"])));

    expect(await readCartCoupons(fetchImpl)).toEqual({ cartId: "cart-1", codes: ["A", "B"] });
  });

  it("returns null when there is no cart or the request fails", async () => {
    expect(await readCartCoupons(vi.fn(async () => response([])))).toBeNull();
    expect(await readCartCoupons(vi.fn(async () => response({}, 500)))).toBeNull();
  });
});

describe("removeCartCoupon", () => {
  it("DELETEs through the storefront checkout API, URL-encoded", async () => {
    const fetchImpl = vi.fn(async () => response({}));

    expect(await removeCartCoupon("cart/1", "HUNT-A B", fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/storefront/checkouts/cart%2F1/coupons/HUNT-A%20B",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("reports a failed removal", async () => {
    expect(await removeCartCoupon("cart-1", "A", vi.fn(async () => response({}, 404)))).toBe(false);
  });
});

describe("couponFromForm", () => {
  function formWith(html: string): HTMLFormElement {
    const input = (name: string, value: string) => ({ value, name });
    const fields: Record<string, { value: string; name: string }> = {};

    // Minimal stand-in for the one querySelector call couponFromForm makes.
    for (const match of html.matchAll(/(\w+)=([^;]*)/g)) fields[match[1]] = input(match[1], match[2]);

    return {
      querySelector: (selector: string) => {
        expect(selector).toBe('input[name*="coupon" i]');

        return Object.values(fields).find((field) => /coupon/i.test(field.name)) ?? null;
      },
    } as unknown as HTMLFormElement;
  }

  it("returns the trimmed code from a coupon field", () => {
    expect(couponFromForm(formWith("couponcode=  HUNT-AAAA1111 "))).toBe("HUNT-AAAA1111");
  });

  it("returns null for an empty field or a form with no coupon field", () => {
    expect(couponFromForm(formWith("couponcode=   "))).toBeNull();
    expect(couponFromForm(formWith("search=shoes"))).toBeNull();
  });
});

describe("checkSubmittedCode", () => {
  it("removes a foreign code, flags the notice and reloads once — even if the cart no longer lists it", async () => {
    const store = stubSessionStorage();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? response({}, 404) : response(cartBody([])),
    );
    const foreignCodes = vi.fn(async () => ["THEIRS"]);
    const reload = vi.fn();

    expect(await checkSubmittedCode(config, "THEIRS", { fetchImpl, foreignCodes, reload })).toBe(true);
    expect(foreignCodes).toHaveBeenCalledExactlyOnceWith(config, ["THEIRS"]);
    expect(fetchImpl.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get("huntry-cart-guard-notice")).toBe("1");
  });

  it("does nothing for a code that isn't someone else's reward code", async () => {
    const store = stubSessionStorage();
    const fetchImpl = vi.fn(async () => response(cartBody([])));
    const reload = vi.fn();

    expect(await checkSubmittedCode(config, "SUMMER10", { fetchImpl, foreignCodes: async () => [], reload })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("still reloads with the notice when the cart can't be read (the webhook may have removed the code)", async () => {
    stubSessionStorage();
    const reload = vi.fn();
    const fetchImpl = vi.fn(async () => response({}, 500));

    expect(await checkSubmittedCode(config, "THEIRS", { fetchImpl, foreignCodes: async () => ["THEIRS"], reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("fails open: a throwing lookup leaves the page alone", async () => {
    stubSessionStorage();
    const reload = vi.fn();

    expect(
      await checkSubmittedCode(config, "A", {
        foreignCodes: async () => {
          throw new Error("boom");
        },
        reload,
      }),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("onCouponSubmitted", () => {
  it("waits once, runs exactly one check and clears the pending marker", async () => {
    const store = stubSessionStorage();
    const wait = vi.fn(async () => {
      // While waiting, the typed code is recorded so a full-page POST could finish the check on the next load.
      expect(store.get("huntry-cart-guard-pending")).toBe("THEIRS");
    });
    const foreignCodes = vi.fn(async () => ["THEIRS"]);
    const reload = vi.fn();
    const fetchImpl = vi.fn(async () => response(cartBody([])));

    expect(await onCouponSubmitted(config, "THEIRS", { wait, foreignCodes, reload, fetchImpl })).toBe(true);
    expect(wait).toHaveBeenCalledExactlyOnceWith(1500);
    expect(foreignCodes).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.has("huntry-cart-guard-pending")).toBe(false);
  });

  it("does not reload for a code that is fine", async () => {
    stubSessionStorage();
    const reload = vi.fn();

    expect(await onCouponSubmitted(config, "SUMMER10", { wait: async () => {}, foreignCodes: async () => [], reload })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
