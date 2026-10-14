// BigCommerce echoes a coupon code as the shopper typed it, while issued codes
// are generated uppercase (rewards/claim-codes.ts), so both sides are compared
// trimmed + uppercased. A leaf module (no repository or API imports) so the
// storage layer can use it without an import cycle through claims/redemption.ts.
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
