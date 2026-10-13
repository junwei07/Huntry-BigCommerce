import { CartGuardDeps, checkSubmittedCode, NOTICE_TEXT, takeNoticeFlag } from "./cart-guard";
import { observeCouponRequests, ObserverTarget } from "./coupon-request-observer";
import { StorefrontConfig } from "./types";

// BC-HUN-051: the checkout-page counterpart of cart-guard.ts. The webhook has
// usually removed another customer's reward code within a second of it being
// applied, but the checkout keeps showing the discount until a reload. When the
// shopper applies a code, one check on that one code (the same
// checkSubmittedCode as the cart page): if it is claimed by someone else the
// page reloads once and shows "Invalid coupon usage". No polling, no re-checks.
// Advisory only; fails open.
const NOTICE_DISMISS_MS = 8000;

// The checkout page itself, not the order-confirmation page under it.
export function isCheckoutPage(pathname: string): boolean {
  return /^\/checkout\/?$/i.test(pathname);
}

// Every page the script must stay out of apart from the guard: the checkout and
// the order confirmation (the script loads there because it is registered for
// all pages, so the banner/CTA/map code must not run).
export function isCheckoutArea(pathname: string): boolean {
  return /^\/checkout(\/|$)/i.test(pathname);
}

// The checkout is a React app that would wipe an element inserted into its
// tree, so the notice is fixed to the viewport and appended to <body>.
// textContent only.
function showCheckoutNotice(): void {
  const notice = document.createElement("div");

  notice.setAttribute("role", "alert");
  notice.textContent = NOTICE_TEXT;
  notice.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:14px 16px;text-align:center;font:600 15px/1.3 sans-serif;border-bottom:1px solid #f5c2c7;background:#f8d7da;color:#842029;";

  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), NOTICE_DISMISS_MS);
}

export function startCheckoutGuard(
  config: StorefrontConfig,
  deps: CartGuardDeps = {},
  target?: ObserverTarget,
): void {
  if (takeNoticeFlag()) showCheckoutNotice();

  observeCouponRequests((code) => void checkSubmittedCode(config, code, deps), target);
}
