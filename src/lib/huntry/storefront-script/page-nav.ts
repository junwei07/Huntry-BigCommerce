// The two sections of the Huntry page: the live hunts and the shopper's own
// rewards (BC-HUN-046). Pure items so the tab logic is testable without a DOM.
export type PageSection = "hunts" | "rewards";

export interface PageNavItem {
  label: string;
  href: string;
  active: boolean;
}

export function pageNavItems(active: PageSection, huntsHref: string, rewardsHref: string): PageNavItem[] {
  return [
    { label: "Hunts", href: huntsHref, active: active === "hunts" },
    { label: "My Rewards", href: rewardsHref, active: active === "rewards" },
  ];
}

// Built with createElement + textContent only, like the other views.
export function renderPageNav(active: PageSection, huntsHref: string, rewardsHref: string): HTMLElement {
  const nav = document.createElement("nav");

  nav.className = "huntry-page-nav";
  nav.setAttribute("aria-label", "Huntry");

  for (const item of pageNavItems(active, huntsHref, rewardsHref)) {
    const link = document.createElement("a");

    link.className = item.active ? "huntry-page-nav__item huntry-page-nav__item--active" : "huntry-page-nav__item";
    link.textContent = item.label;
    link.href = item.href;

    if (item.active) link.setAttribute("aria-current", "page");

    nav.appendChild(link);
  }

  return nav;
}
