import { fetchForeignCouponCodes } from "./api";
import { StorefrontConfig } from "./types";

// BC-HUN-050: when a shopper submits a coupon code on the cart page, checks
// that one code once: if it is a reward code claimed by someone else, it is
// removed from the cart and the shopper sees "Invalid coupon usage". Nothing
// runs until a code is submitted — no load-time check, no polling, no cart
// re-reading. Advisory UX only: it runs in the shopper's browser, so it is
// bypassable and never the enforcing layer (that is the
// `store/cart/couponApplied` webhook, claims/cart-coupon-enforcement.ts, which
// has usually removed the code server-side by the time this check runs — the
// guard's job is to make the page show it). It fails open: any error leaves
// the cart untouched. Like claim-ui/cart.ts it talks to BigCommerce's own
// Storefront API from the shopper's session, never through our server.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CARTS_URL = "/api/storefront/carts";
// Coupons are removed through the Storefront Checkout API — the cart API only
// adds them.
const CHECKOUTS_URL = "/api/storefront/checkouts";
const NOTICE_ID = "huntry-cart-guard-notice";
// Shared with the checkout guard (checkout-guard.ts), which reuses
// checkSubmittedCode and so the same carried-over flag.
export const NOTICE_TEXT = "Invalid coupon usage";
// A typed code survives a full-page form POST (which would kill the timer
// below) so the one check can still run on the next load.
const PENDING_KEY = "huntry-cart-guard-pending";
// One short wait so the apply request, and the webhook's own removal, have
// settled before the single check.
const CHECK_DELAY_MS = 1500;

export function isCartPage(pathname: string): boolean {
  return /^\/cart(\.php)?\/?$/i.test(pathname);
}

interface CartCoupons {
  cartId: string;
  codes: string[];
}

export async function readCartCoupons(fetchImpl: FetchLike = fetch): Promise<CartCoupons | null> {
  const response = await fetchImpl(CARTS_URL, { credentials: "same-origin", headers: { Accept: "application/json" } });

  if (!response.ok) return null;

  const carts: unknown = await response.json().catch(() => null);
  const cart = Array.isArray(carts) ? (carts[0] as { id?: unknown; coupons?: unknown } | undefined) : undefined;

  if (!cart || typeof cart.id !== "string") return null;

  const codes = Array.isArray(cart.coupons)
    ? cart.coupons.map((coupon) => (coupon as { code?: unknown } | null)?.code).filter((code): code is string => typeof code === "string")
    : [];

  return { cartId: cart.id, codes };
}

export async function removeCartCoupon(cartId: string, code: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const response = await fetchImpl(`${CHECKOUTS_URL}/${encodeURIComponent(cartId)}/coupons/${encodeURIComponent(code)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  return response.ok;
}

// sessionStorage can throw (private mode, blocked storage); every use degrades
// to "no notice / no carried-over check".
function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Ignored.
  }
}

// Reads and removes in one step, so a value can be acted on at most once.
function storageTake(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);

    if (value !== null) sessionStorage.removeItem(key);

    return value;
  } catch {
    return null;
  }
}

// True once after checkSubmittedCode flagged a code and reloaded the page.
export function takeNoticeFlag(): boolean {
  return storageTake(NOTICE_ID) !== null;
}

export interface CartGuardDeps {
  fetchImpl?: FetchLike;
  foreignCodes?: (config: StorefrontConfig, codes: string[]) => Promise<string[]>;
  reload?: () => void;
  wait?: (ms: number) => Promise<void>;
}

// The single check: ask the server whether this submitted code is someone
// else's reward code. If so, make sure it is out of the cart (the webhook has
// usually done it already, so a failure or 404 here is fine) and reload once,
// carrying the notice across. Resolves true only when it acted. Never throws.
export async function checkSubmittedCode(
  config: StorefrontConfig,
  code: string,
  deps: CartGuardDeps = {},
): Promise<boolean> {
  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const foreign = await (deps.foreignCodes ?? fetchForeignCouponCodes)(config, [code]);

    if (foreign.length === 0) return false;

    const cart = await readCartCoupons(fetchImpl).catch(() => null);

    if (cart) await removeCartCoupon(cart.cartId, code, fetchImpl).catch(() => false);

    storageSet(NOTICE_ID, "1");
    (deps.reload ?? (() => window.location.reload()))();

    return true;
  } catch {
    return false;
  }
}

// One submitted code → exactly one check. The pending marker is cleared before
// the check so the load-time path (below) can't repeat it.
export async function onCouponSubmitted(
  config: StorefrontConfig,
  code: string,
  deps: CartGuardDeps = {},
): Promise<boolean> {
  storageSet(PENDING_KEY, code);
  await (deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(CHECK_DELAY_MS);
  storageTake(PENDING_KEY);

  return checkSubmittedCode(config, code, deps);
}

// The typed code of a submitted coupon form, or null for any other form. Themes
// name the field "couponcode"; matching on "coupon" keeps gift-certificate and
// search forms out.
export function couponFromForm(form: HTMLFormElement): string | null {
  const input = form.querySelector<HTMLInputElement>('input[name*="coupon" i]');
  const value = input?.value.trim();

  return value ? value : null;
}

// textContent only: nothing from the API ever reaches innerHTML.
function showNotice(): void {
  if (document.getElementById(NOTICE_ID)) return;

  const notice = document.createElement("div");

  notice.id = NOTICE_ID;
  notice.setAttribute("role", "alert");
  notice.textContent = NOTICE_TEXT;
  notice.style.cssText = "margin:12px 0;padding:12px 16px;border:1px solid #f5c2c7;background:#f8d7da;color:#842029;border-radius:4px;";

  const host = document.querySelector("[data-cart-content], main, #main-content") ?? document.body;

  host.insertBefore(notice, host.firstChild);
}

// Listens for a coupon form being submitted. Capture phase, so it sees the
// submit even when the theme handles it with its own AJAX handler and stops the
// event. On load it shows a notice carried across the reload, and finishes a
// check that a full-page form POST cut short.
export function startCartGuard(config: StorefrontConfig): void {
  if (takeNoticeFlag()) showNotice();

  const pending = storageTake(PENDING_KEY);

  if (pending) void checkSubmittedCode(config, pending);

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      const code = form instanceof HTMLFormElement ? couponFromForm(form) : null;

      if (code) void onCouponSubmitted(config, code);
    },
    true,
  );
}
