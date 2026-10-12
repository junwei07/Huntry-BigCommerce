import { buildCards, endsCountdown, EventCard, formatDateRange } from "./cards";
import { renderPageNav } from "./page-nav";
import { rewardsUrl } from "./page-mode";
import { HUNTRY_CARDS_CSS } from "./styles.generated";
import { StorefrontEvent } from "./types";

// DOM for the /huntry/ listing and its empty / not-found states. Everything
// from the API (names, descriptions, image URLs) is set with textContent or a
// property, never innerHTML: it is admin-authored and runs on the merchant's
// origin. Image URLs are already restricted to http(s) by the server.
function injectStyles(): void {
  if (document.querySelector("style[data-huntry-cards-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryCardsCss = "";
  style.textContent = HUNTRY_CARDS_CSS;
  document.head.appendChild(style);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

export function listingUrl(): string {
  return window.location.pathname;
}

function eventUrl(slug: string): string {
  return `${listingUrl()}?event=${encodeURIComponent(slug)}`;
}

function buildCard(card: EventCard): { node: HTMLAnchorElement; tick: (now: number) => void } {
  const link = element("a", "huntry-card");
  const body = element("div", "huntry-card__body");
  const countdown = element("p", "huntry-card__meta");
  const range = formatDateRange(card.startsAt, card.endsAt);

  link.href = eventUrl(card.slug);

  if (card.bannerUrl) {
    const banner = element("img", "huntry-card__banner");

    banner.src = card.bannerUrl;
    banner.alt = "";
    link.appendChild(banner);
  }

  body.appendChild(element("span", "huntry-card__pill", "Live"));
  body.appendChild(element("h3", "huntry-card__title", card.name));
  body.appendChild(countdown);

  if (range) {
    body.appendChild(element("p", "huntry-card__meta", range));
  }

  if (card.description) {
    body.appendChild(element("p", "huntry-card__desc", card.description));
  }

  body.appendChild(element("span", "huntry-card__cta", "Start Hunting"));
  link.appendChild(body);

  const tick = (now: number) => {
    const text = endsCountdown(card.endsAt, now);

    countdown.textContent = text ?? "";
    countdown.hidden = text === null;
  };

  return { node: link, tick };
}

// Renders the cards for the live events, or the empty message. Returns a
// function that stops the countdown timer.
export function renderListing(container: HTMLElement, events: StorefrontEvent[]): () => void {
  injectStyles();
  container.textContent = "";
  container.appendChild(renderPageNav("hunts", listingUrl(), rewardsUrl()));

  const cards = buildCards(events);

  if (cards.length === 0) {
    container.appendChild(element("p", "huntry-cards-message", "No hunts are live right now. Check back soon!"));

    return () => {};
  }

  const grid = element("div", "huntry-cards");
  const built = cards.map(buildCard);

  for (const { node } of built) {
    grid.appendChild(node);
  }

  container.appendChild(grid);

  const tickAll = () => built.forEach(({ tick }) => tick(Date.now()));
  const timer = window.setInterval(tickAll, 1000);

  tickAll();

  return () => window.clearInterval(timer);
}

export function renderNotFound(container: HTMLElement): void {
  injectStyles();
  container.textContent = "";

  const message = element("p", "huntry-cards-message", "We couldn't find that hunt. ");
  const back = element("a", "", "Back to all hunts");

  back.href = listingUrl();
  message.appendChild(back);
  container.appendChild(message);
}
