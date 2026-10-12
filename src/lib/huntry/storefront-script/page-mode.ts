import { StorefrontEvent } from "./types";

// What the Huntry page shows, decided from the live events and the ?event=
// slug. Mirrors the WordPress plugin's /huntry/ (event cards) versus
// /huntry/<slug>/ (one fullscreen map) split, with the slug as a query
// parameter because Stencil has no rewrite rules. ?view=rewards is the "My
// rewards" list (BC-HUN-046), the stand-in for the plugin's My Account tab.
export type PageMode =
  | { kind: "listing"; events: StorefrontEvent[] }
  | { kind: "map"; event: StorefrontEvent }
  | { kind: "rewards" }
  | { kind: "not-found" };

export const REWARDS_VIEW = "rewards";

export function rewardsUrl(): string {
  return `${window.location.pathname}?view=${REWARDS_VIEW}`;
}

export function decideMode(events: StorefrontEvent[], slug?: string, view?: string): PageMode {
  if (view === REWARDS_VIEW) {
    return { kind: "rewards" };
  }

  if (!slug) {
    return { kind: "listing", events };
  }

  const event = events.find((item) => item.slug === slug);

  return event ? { kind: "map", event } : { kind: "not-found" };
}
