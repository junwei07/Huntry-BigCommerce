// The per-reward egg-placement cap (BC-HUN-018's rewards-api.ts imports this
// to bound huntry_rewards.egg_capacity; the bounds check lives in
// BC-HUN-019's zod schema, matching how markerRadiusMeters/maxGrabCount are
// bounded in events/event-form-schema.ts rather than in events-api.ts).
//
// MAX_EGGS_PER_EVENT is the independent per-event cap (BC-HUN-027).
// docs/MIGRATION.md §3/§7 is explicit that the two 30-caps must stay
// independent named constants, never merged into one — placement
// (eggs/placement.ts) checks them separately.
export const MAX_EGGS_PER_REWARD = 30;
export const MAX_EGGS_PER_EVENT = 30;
