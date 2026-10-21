// A deliberate business restriction: distinct players (customers holding a
// claim, forced or not) per event. A customer who already holds a claim in the
// event is never refused by it.
export const MAX_PLAYERS_PER_EVENT = 100;
