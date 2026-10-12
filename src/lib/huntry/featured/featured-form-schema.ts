import { z } from "zod";

// Shared by featured/actions.ts and the form. A plain module rather than
// living in the "use server" file (only async functions may be exported from
// one) — same reasoning as sponsors/sponsor-form-schema.ts.
//
// Every field may be blank: blank means "use the default copy". The banner
// images are deliberately not fields (preview-only uploads, BC-HUN-044).
export const featuredFormSchema = z.object({
  bannerDescription: z.string().trim().max(120, "Banner description must be 120 characters or fewer."),
  productCtaTitle: z.string().trim().max(120, "Product CTA title must be 120 characters or fewer."),
  productCtaDescription: z.string().trim().max(240, "Product CTA description must be 240 characters or fewer."),
});

export interface FeaturedFormInput {
  bannerDescription: string;
  productCtaTitle: string;
  productCtaDescription: string;
}
