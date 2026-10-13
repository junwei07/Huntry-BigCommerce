// BC-HUN-051: tells the checkout guard when the shopper applies a coupon code.
// BigCommerce's checkout is its own React app, so the coupon form's markup is
// not something to rely on; the code travels in the Storefront API request
// POST /api/storefront/checkouts/{id}/coupons with body {"couponCode": "..."},
// which is exactly "the shopper applied a code". This only ever *observes*: the
// originals are always called with the arguments they were given, and every
// piece of observer code is wrapped so it can never break the checkout.

export interface ObserverTarget {
  XMLHttpRequest?: typeof XMLHttpRequest;
  fetch?: typeof fetch;
}

const APPLY_URL = /\/api\/storefront\/(?:checkouts|carts)\/[^/?#]+\/coupons\/?(?:[?#].*)?$/i;

// The typed code of a coupon-apply request, or null for any other request.
export function couponFromRequest(method: string, url: string, body: unknown): string | null {
  if (method.toUpperCase() !== "POST" || !APPLY_URL.test(url) || typeof body !== "string") return null;

  try {
    const parsed = JSON.parse(body) as { couponCode?: unknown } | null;
    const code = typeof parsed?.couponCode === "string" ? parsed.couponCode.trim() : "";

    return code || null;
  } catch {
    return null;
  }
}

function notify(onApplied: (code: string) => void, code: string): void {
  try {
    onApplied(code);
  } catch {
    // Observer callbacks must never throw into the page.
  }
}

// Calls onApplied(code) once per coupon-apply request, after the request has
// finished — whatever its HTTP status (a rejected apply of someone else's code
// should still get the notice); a network failure with no response is skipped.
export function observeCouponRequests(
  onApplied: (code: string) => void,
  target: ObserverTarget = window as unknown as ObserverTarget,
): void {
  const proto = target.XMLHttpRequest?.prototype;

  if (proto) {
    const originalOpen = proto.open as (...args: unknown[]) => void;
    const originalSend = proto.send as (body?: unknown) => void;
    const requests = new WeakMap<object, { method: string; url: string }>();

    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        requests.set(this, { method: String(args[0]), url: String(args[1]) });
      } catch {
        // Fall through to the original.
      }

      return originalOpen.apply(this, args);
    } as typeof proto.open;

    proto.send = function (this: XMLHttpRequest, body?: unknown) {
      try {
        const request = requests.get(this);

        if (request) {
          const code = couponFromRequest(request.method, request.url, body);

          if (code) this.addEventListener("loadend", () => notify(onApplied, code), { once: true });
        }
      } catch {
        // Fall through to the original.
      }

      return originalSend.call(this, body);
    } as typeof proto.send;
  }

  const originalFetch = target.fetch;

  if (originalFetch) {
    target.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      let code: string | null = null;

      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");

        code = couponFromRequest(method, url, init?.body);
      } catch {
        // Fall through to the original.
      }

      const result = originalFetch.call(target, input, init);

      if (code) {
        const appliedCode = code;

        result.then(
          () => notify(onApplied, appliedCode),
          () => {},
        );
      }

      return result;
    } as typeof fetch;
  }
}
