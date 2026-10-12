import type { DiscountType } from "@/lib/huntry/rewards/types";

// The reward's own on/off switch and window, shared by the claim transaction
// (player-claim.ts evaluateClaim, which adds the promotion check) and the
// storefront rewards list's "Expired" pill so the two can't disagree.
export function isRewardWindowOpen(
  reward: { status: string; startsAt: Date | null; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  return reward.status === "active" && (!reward.startsAt || reward.startsAt <= now) && (!reward.expiresAt || reward.expiresAt > now);
}

// Port of huntry_format_reward_card_headline (my-account.php L185-199). The
// store's currency isn't known here, so a fixed amount uses "$" like the
// admin UI's own discount display.
export function formatRewardHeadline(discountType: DiscountType, discountValue: number): string {
  const amount = Number.isInteger(discountValue) ? String(discountValue) : discountValue.toFixed(2);

  return discountType === "percent" ? `Get ${amount}% OFF` : `Get $${amount} OFF`;
}

// A BigCommerce `custom_url.url` is a path on the storefront. Anything else
// (absolute URLs, protocol-relative `//host`, `javascript:`) is dropped so a
// product link can only ever stay on the merchant's own origin.
export function safeStorefrontPath(url: unknown): string | null {
  return typeof url === "string" && /^\/(?!\/)[^\s\\]*$/.test(url) ? url : null;
}
