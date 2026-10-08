import { StorefrontEvent } from "./types";

// What the Huntry page shows, decided from the live events and the ?event=
// slug. Mirrors the WordPress plugin's /huntry/ (event cards) versus
// /huntry/<slug>/ (one fullscreen map) split, with the slug as a query
// parameter because Stencil has no rewrite rules.
export type PageMode =
  | { kind: "listing"; events: StorefrontEvent[] }
  | { kind: "map"; event: StorefrontEvent }
  | { kind: "not-found" };

export function decideMode(events: StorefrontEvent[], slug?: string): PageMode {
  if (!slug) {
    return { kind: "listing", events };
  }

  const event = events.find((item) => item.slug === slug);

  return event ? { kind: "map", event } : { kind: "not-found" };
}
