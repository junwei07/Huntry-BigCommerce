// "Apply to my cart" runs in the shopper's browser against BigCommerce's own
// Storefront Cart API (same origin as the storefront), never through our
// backend: that API is bound to the shopper's session cookie, which our server
// can't see or proxy (docs/MIGRATION.md §4). Don't add a server-side route.
export type CartResult =
  | { kind: "applied" }
  // No cart exists yet and the Storefront API can't create an empty one.
  | { kind: "no-cart" }
  | { kind: "rejected"; message: string }
  | { kind: "error" };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CARTS_URL = "/api/storefront/carts";

async function readMessage(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);

  if (!body || typeof body !== "object") return null;

  const { detail, title } = body as { detail?: unknown; title?: unknown };

  for (const candidate of [detail, title]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  return null;
}

export async function applyCouponToCart(couponCode: string, fetchImpl: FetchLike = fetch): Promise<CartResult> {
  try {
    const cartsResponse = await fetchImpl(CARTS_URL, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!cartsResponse.ok) return { kind: "error" };

    const carts: unknown = await cartsResponse.json().catch(() => null);
    const cartId =
      Array.isArray(carts) && carts[0] && typeof carts[0].id === "string" ? (carts[0].id as string) : null;

    if (!cartId) return { kind: "no-cart" };

    const response = await fetchImpl(`${CARTS_URL}/${encodeURIComponent(cartId)}/coupons`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ couponCode }),
    });

    if (response.ok) return { kind: "applied" };

    // 4xx is BigCommerce explaining why the code can't be used (empty cart,
    // not eligible, already applied); anything else is a transient failure.
    if (response.status >= 400 && response.status < 500) {
      return { kind: "rejected", message: (await readMessage(response)) ?? "This code can't be applied to your cart." };
    }

    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}
