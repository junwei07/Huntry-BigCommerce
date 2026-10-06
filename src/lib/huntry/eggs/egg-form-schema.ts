import { z } from "zod";

// Shared by map/actions.ts (a plain module, not the "use server" file, since
// Next.js only allows async-function exports there) — same reasoning as
// reward-form-schema.ts. Name cap matches the plugin's huntry_sanitize_egg_name.
export const MAX_EGG_NAME_LENGTH = 120;

const eggNameSchema = z.string().trim().max(MAX_EGG_NAME_LENGTH, `Name must be ${MAX_EGG_NAME_LENGTH} characters or fewer.`);

const coordinateSchema = {
  lat: z.number().min(-90, "Invalid latitude.").max(90, "Invalid latitude."),
  lng: z.number().min(-180, "Invalid longitude.").max(180, "Invalid longitude."),
};

// A queued placement — blank name is allowed and auto-named on save.
export const eggPlacementSchema = z.object({
  rewardId: z.number().int().positive("Pick a reward."),
  name: eggNameSchema,
  ...coordinateSchema,
});

export type EggPlacementInput = z.infer<typeof eggPlacementSchema>;

// Editing: lat/lng are optional (only the "Edit Location" confirm sends
// them). A blank name keeps the egg's existing one.
export const eggUpdateSchema = z.object({
  rewardId: z.number().int().positive("Pick a reward."),
  name: eggNameSchema,
  lat: coordinateSchema.lat.optional(),
  lng: coordinateSchema.lng.optional(),
});

export type EggUpdateInput = z.infer<typeof eggUpdateSchema>;

// Force Claim (BC-HUN-029): the customer to credit is identified by email.
export const forceClaimEmailSchema = z.string().trim().email("Enter a valid customer email.");
