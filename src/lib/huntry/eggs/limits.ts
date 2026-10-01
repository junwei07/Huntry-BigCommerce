// The per-reward egg-placement cap (BC-HUN-018's rewards-api.ts imports this
// to bound huntry_rewards.egg_capacity in a future validation layer; the
// actual bounds check lives in BC-HUN-019's zod schema, matching how
// markerRadiusMeters/maxGrabCount are bounded in events/event-form-schema.ts
// rather than in events-api.ts itself).
//
// MAX_EGGS_PER_EVENT (the independent per-event cap enforced by BC-HUN-027)
// deliberately isn't added here yet — it belongs with the eggs DAL ticket
// (BC-HUN-024+) that actually builds src/lib/huntry/eggs/eggs-api.ts.
// docs/MIGRATION.md §3/§7 is explicit that the two 30-caps must stay
// independent named constants, never merged into one — this file is kept
// ready for that second constant to land beside this one without disturbing
// it.
export const MAX_EGGS_PER_REWARD = 30;
