import { z } from "zod";

// Shared by both sponsors/actions.ts (create) and sponsors/[id]/actions.ts
// (update) — a plain module rather than living in either "use server" file,
// since Next.js only allows async-function exports from a "use server"
// file, and this is a zod value, not a function. Mirrors
// events/event-form-schema.ts's exact reasoning.

// WP's sponsor meta box (huntry/includes/sponsors/index.php) has no
// `required` attribute on any field but the post title — see
// docs/HUNTRY-UI-REFERENCE.md. Instagram/Facebook/Website are plain
// `type="url"` inputs; empty is allowed, and when non-empty must actually be
// a URL. Location is a plain `type="text"` field (not lat/lng, not a map
// link) sanitized with `sanitize_text_field`, so no format validation beyond
// a length cap.
//
// logoUrl is optional (BC-HUN-044): LogoUploadField uploads the picked file
// to Firebase Storage straight away and the form submits the returned URL.
// It is not validated here — the Server Actions check it against the store's
// own storage prefix (resolveImageField) and fall back to
// DEFAULT_SPONSOR_LOGO_URL on create / the existing logo on update when it
// is blank.
function urlField(label: string) {
  return z.string().trim().refine((value) => value === "" || z.string().url().safeParse(value).success, {
    message: `${label} must be a valid URL.`,
  });
}

export const sponsorFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200, "Name must be 200 characters or fewer."),
  instagramUrl: urlField("Instagram URL"),
  facebookUrl: urlField("Facebook URL"),
  websiteUrl: urlField("Website URL"),
  location: z.string().trim().max(500, "Location must be 500 characters or fewer."),
  logoUrl: z.string().trim().max(2048).optional(),
});

// The raw shape both new-sponsor-form.tsx and edit-sponsor-form.tsx submit —
// every field is a string (what native form inputs produce); the Server
// Actions convert "" to null before calling the DAL, which wants
// `string | null`.
export interface SponsorFormInput {
  name: string;
  instagramUrl: string;
  facebookUrl: string;
  websiteUrl: string;
  location: string;
  logoUrl?: string;
}
