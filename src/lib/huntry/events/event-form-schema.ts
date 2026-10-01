import { z } from "zod";
import {
  EVENT_THEME_PRESETS,
  EventItemMarker,
  EventLocationMarker,
  EventThemeColors,
  ITEM_MARKER_PRESET_COUNT,
  LOCATION_MARKER_PRESET_COUNT,
} from "@/lib/huntry/events/types";

// Shared by both events/actions.ts (create) and events/[id]/actions.ts
// (update) — a plain module rather than living in either "use server" file,
// since Next.js only allows async-function exports from a "use server"
// file, and this is a zod value, not a function.

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const eventThemeColorsSchema = z.object({
  preset: z
    .number()
    .int()
    .min(0)
    .max(EVENT_THEME_PRESETS.length - 1)
    .nullable(),
  primaryColor: z.string().regex(HEX_COLOR_REGEX, "Primary color must be a hex color."),
  successColor: z.string().regex(HEX_COLOR_REGEX, "Success color must be a hex color."),
});

// Neither marker section is required in the WP source form (no `required`
// attribute on either) — presetIndex/URLs are left nullable/optional so an
// event can be created/saved with no marker configured, matching that
// leniency.
const eventItemMarkerSchema = z.object({
  source: z.enum(["preset", "custom"]),
  presetIndex: z.number().int().min(1).max(ITEM_MARKER_PRESET_COUNT).nullable(),
  unclaimedIconUrl: z.string().trim().nullable(),
  claimedIconUrl: z.string().trim().nullable(),
});

const eventLocationMarkerSchema = z.object({
  source: z.enum(["preset", "custom"]),
  presetIndex: z.number().int().min(1).max(LOCATION_MARKER_PRESET_COUNT).nullable(),
  iconUrl: z.string().trim().nullable(),
});

// markerRadiusMeters/maxGrabCount/eggClaimCapacity bounds are sourced from
// huntry/EVMS's add-event validation (see docs/HUNTRY-UI-REFERENCE.md):
// radius 5-500m; maxGrabCount and eggClaimCapacity both > 0, no ceiling.
// Both are deliberate, user-directed departures from the WP plugin's own
// form (which allows maxGrabCount = 0 for "unlimited" and has no radius
// ceiling) — kept as-is even after switching the rest of this form to the
// WP plugin as its reference. See the reference doc for why that's
// intentional, not an oversight.
//
// name/startsAt/endsAt/description are all required, matching the WP
// form's own `required` HTML attributes — no slug field at all (see
// events-api.ts's createEvent/updateEvent, which derive/preserve it
// server-side, WordPress-style).
export const eventFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200, "Name must be 200 characters or fewer."),
    startsAt: z.string().trim().min(1, "Start date is required."),
    endsAt: z.string().trim().min(1, "End date is required."),
    description: z
      .string()
      .trim()
      .min(1, "Description is required.")
      .max(2000, "Description must be 2000 characters or fewer."),
    markerRadiusMeters: z.coerce
      .number()
      .int("Marker radius must be a whole number.")
      .min(5, "Marker radius must be at least 5 meters.")
      .max(500, "Marker radius must be 500 meters or fewer."),
    maxGrabCount: z.coerce
      .number()
      .int("Max user grab count must be a whole number.")
      .min(1, "Max user grab count must be greater than 0."),
    eggClaimCapacity: z.coerce
      .number()
      .int("Item claim count must be a whole number.")
      .min(1, "Item claim count must be greater than 0."),
    itemMarker: eventItemMarkerSchema,
    locationMarker: eventLocationMarkerSchema,
    themeColors: eventThemeColorsSchema,
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: "End date must be after the start date.",
    path: ["endsAt"],
  });

// The raw shape both new-event-form.tsx and edit-event-form.tsx submit —
// numeric/date fields are strings (what native form inputs produce),
// coerced/validated by eventFormSchema above.
export interface EventFormInput {
  name: string;
  startsAt: string;
  endsAt: string;
  description: string;
  markerRadiusMeters: string;
  maxGrabCount: string;
  eggClaimCapacity: string;
  itemMarker: EventItemMarker;
  locationMarker: EventLocationMarker;
  themeColors: EventThemeColors;
}
