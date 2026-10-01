import { z } from "zod";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { DiscountScope, DiscountType } from "@/lib/huntry/rewards/types";

// Shared by both rewards/actions.ts (create) and rewards/[id]/actions.ts
// (update) — a plain module rather than living in either "use server" file,
// since Next.js only allows async-function exports from a "use server"
// file, and this is a zod value, not a function. Mirrors
// sponsor-form-schema.ts/event-form-schema.ts's exact reasoning.

// Field list/requiredness source: huntry/includes/rewards/meta-box.php's
// huntry_render_reward_details_meta_box() — see docs/HUNTRY-UI-REFERENCE.md.
// EVMS has no equivalent reward model (no discount type/value/scope/product
// fields at all), so there's nothing to reconcile there.
//
// Unlike the WP form's required "Gift Card Code" input, couponCode isn't a
// form field here at all — BC-HUN-020's coupon-sync populates it later; the
// edit form only ever displays the DAL's existing value read-only.
//
// rewardStartsAt/rewardExpiresAt are both required, matching the WP form's
// own `required` attributes on both date fields, even though the DB column
// (and HuntryReward's own type) allows null — nothing overrides the WP
// plugin's rule here, so the form follows it. The expiry-after-start
// `.refine` below isn't in the WP plugin's own server-side validation (its
// save handler has no such check), but this app's own precedent already
// adds the identical check for events (event-form-schema.ts) — applying the
// same discipline here, not a WP departure that needs separate
// justification.
//
// discountValue is capped at 100 for discountType === "percent" — WP itself
// allows any non-negative value including an unbounded percent, which is a
// correctness bug worth not replicating (a 150% "discount" makes no
// commercial sense). fixed_cart stays >= 0, uncapped, matching WP exactly.
export const rewardFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200, "Name must be 200 characters or fewer."),
    description: z
      .string()
      .trim()
      .min(1, "Description is required.")
      .max(2000, "Description must be 2000 characters or fewer."),
    sponsorId: z.string(),
    rewardStartsAt: z.string().trim().min(1, "Start date is required."),
    rewardExpiresAt: z.string().trim().min(1, "Expiry date is required."),
    eggCapacity: z.coerce
      .number()
      .int("Number of eggs must be a whole number.")
      .min(1, "Number of eggs must be at least 1.")
      .max(MAX_EGGS_PER_REWARD, `Number of eggs must be ${MAX_EGGS_PER_REWARD} or fewer.`),
    discountType: z.enum(["percent", "fixed_cart"]),
    discountValue: z.coerce.number().min(0, "Value must be zero or greater."),
    discountScope: z.enum(["all", "specific"]),
    // Only meaningful when discountScope === "specific" — the required-when-
    // specific check lives in the refine below rather than here, since zod
    // can't cross-reference a sibling field inside a single field schema.
    productIds: z.array(z.number().int()),
  })
  .refine((data) => new Date(data.rewardExpiresAt) > new Date(data.rewardStartsAt), {
    message: "Expiry date must be after the start date.",
    path: ["rewardExpiresAt"],
  })
  .refine((data) => data.discountType !== "percent" || data.discountValue <= 100, {
    message: "Percent discounts cannot exceed 100.",
    path: ["discountValue"],
  })
  .refine((data) => data.discountScope !== "specific" || data.productIds.length > 0, {
    message: "Select at least one product for a product-specific reward.",
    path: ["productIds"],
  });

// The raw shape both new-reward-form.tsx and edit-reward-form.tsx submit —
// every scalar field is a string (what native form inputs produce, coerced/
// validated by rewardFormSchema above), except productIds, which is managed
// as React state by ProductPicker and never typed into a native input.
// sponsorId is the sponsor <select>'s value — "" means no sponsor selected.
export interface RewardFormInput {
  name: string;
  description: string;
  sponsorId: string;
  rewardStartsAt: string;
  rewardExpiresAt: string;
  eggCapacity: string;
  discountType: DiscountType;
  discountValue: string;
  discountScope: DiscountScope;
  productIds: number[];
}
