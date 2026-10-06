// Port of the WP plugin's HUNTRY_MAX_EVENTS (huntry/includes/events/index.php:18).
// A deliberate business restriction, not a technical one — see
// huntry/docs/decisions/0009-event-limit-is-a-business-restriction.md.
// Unlike WP there is no trash/status column here, so every event row counts.
export const MAX_EVENTS = 1;

export const EVENT_LIMIT_MESSAGE = "You've reached your Huntry event limit.";
