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

// BigCommerce's own login page, asked to send the shopper back to this exact
// page (path + ?event=/?view=) afterwards. `from` is BigCommerce's native
// return parameter (the one it adds itself when a guest opens /account.php): a
// root-relative path without the leading slash. It has to be this, not a
// redirect_to field: the loader doesn't run on /login.php (Script Manager's
// "storefront" visibility leaves the customer pages out) and the theme's login
// form has no such field.
export function loginUrl(): string {
  const path = (window.location.pathname + window.location.search).replace(/^\/+/, "");

  return `/login.php?from=${encodeURIComponent(path)}`;
}

// ?view=rewards, or a plain /huntry/#rewards link, opens the rewards section.
export function readView(search: string, hash: string): string | undefined {
  const view = new URLSearchParams(search).get("view")?.trim();

  return view || (hash === `#${REWARDS_VIEW}` ? REWARDS_VIEW : undefined);
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
