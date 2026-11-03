import { buildCards, endsCountdown, EventCard, formatDateRange, startsCountdown } from "./cards";
import { renderPageNav } from "./page-nav";
import { rewardsUrl } from "./page-mode";
import { HUNTRY_CARDS_CSS } from "./styles.generated";
import { StorefrontEvent, StorefrontMapData, StorefrontUpcomingEvent } from "./types";

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

// A live card links to the hunt's map. An upcoming card has the same layout but
// is not a link (its map is not open yet) and counts down to the start.
function buildCard(card: EventCard): { node: HTMLElement; tick: (now: number) => void } {
  const upcoming = card.status === "upcoming";
  const body = element("div", "huntry-card__body");
  const countdown = element("p", "huntry-card__meta");
  const range = formatDateRange(card.startsAt, card.endsAt);
  let link: HTMLElement;

  if (upcoming) {
    link = element("div", "huntry-card huntry-card--upcoming");
    link.setAttribute("aria-disabled", "true");
  } else {
    const anchor = element("a", "huntry-card");

    anchor.href = eventUrl(card.slug);
    link = anchor;
  }

  if (card.bannerUrl) {
    const banner = element("img", "huntry-card__banner");

    banner.src = card.bannerUrl;
    banner.alt = "";
    link.appendChild(banner);
  }

  body.appendChild(
    upcoming
      ? element("span", "huntry-card__pill huntry-card__pill--upcoming", "Upcoming")
      : element("span", "huntry-card__pill", "Live"),
  );
  body.appendChild(element("h3", "huntry-card__title", card.name));
  body.appendChild(countdown);

  if (range) {
    body.appendChild(element("p", "huntry-card__meta", range));
  }

  if (card.description) {
    body.appendChild(element("p", "huntry-card__desc", card.description));
  }

  body.appendChild(
    upcoming
      ? element("span", "huntry-card__cta huntry-card__cta--disabled", "Coming Soon")
      : element("span", "huntry-card__cta", "Start Hunting"),
  );
  link.appendChild(body);

  const tick = (now: number) => {
    const text = upcoming ? startsCountdown(card.startsAt, now) : endsCountdown(card.endsAt, now);

    countdown.textContent = text ?? "";
    countdown.hidden = text === null;
  };

  return { node: link, tick };
}

const POLL_INTERVAL_MS = 10_000;
// How long to keep asking after a start has passed before giving up (the card
// then stays "Starting now" until the page is reloaded).
const POLL_WINDOW_MS = 180_000;

function slugKey(live: StorefrontEvent[], upcoming: StorefrontUpcomingEvent[]): string {
  return `${live.map((event) => event.slug).join(",")}|${upcoming.map((event) => event.slug).join(",")}`;
}

// Renders the cards for the live and upcoming events, or the empty message.
// With `refetch`, once an upcoming hunt's start has passed it asks for fresh
// data every few seconds (the endpoint is cached for up to 30 s) and redraws
// when the lists change, so the card becomes a live, clickable one in place.
// Returns a function that stops the timers.
export function renderListing(
  container: HTMLElement,
  events: StorefrontEvent[],
  upcoming: StorefrontUpcomingEvent[] = [],
  refetch?: () => Promise<StorefrontMapData>,
): () => void {
  injectStyles();

  let tickTimer: number | undefined;
  let pollTimer: number | undefined;
  let overdueSince: number | null = null;
  let live = events;
  let soon = upcoming;

  const stop = () => {
    window.clearInterval(tickTimer);
    window.clearInterval(pollTimer);
    tickTimer = undefined;
    pollTimer = undefined;
  };

  const hasOverdue = (now: number) => soon.some((event) => new Date(event.startsAt).getTime() <= now);

  const poll = async () => {
    const now = Date.now();

    if (!refetch || document.hidden || !hasOverdue(now)) return;

    overdueSince ??= now;

    if (now - overdueSince > POLL_WINDOW_MS) {
      window.clearInterval(pollTimer);
      pollTimer = undefined;

      return;
    }

    try {
      const data = await refetch();

      // Stopped (or redrawn) while the request was in flight.
      if (pollTimer === undefined) return;

      if (slugKey(data.events, data.upcoming) !== slugKey(live, soon)) {
        live = data.events;
        soon = data.upcoming;
        overdueSince = null;
        draw();
      }
    } catch {
      // A failed refresh is not worth an error on the page: keep what is shown.
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  function draw(): void {
    stop();
    container.textContent = "";
    container.appendChild(renderPageNav("hunts", listingUrl(), rewardsUrl()));

    const cards = buildCards(live, soon);

    if (cards.length === 0) {
      container.appendChild(element("p", "huntry-cards-message", "No hunts are live right now. Check back soon!"));

      return;
    }

    const grid = element("div", "huntry-cards");
    const built = cards.map(buildCard);

    for (const { node } of built) {
      grid.appendChild(node);
    }

    container.appendChild(grid);

    const tickAll = () => built.forEach(({ tick }) => tick(Date.now()));

    tickTimer = window.setInterval(tickAll, 1000);
    tickAll();

    if (refetch && soon.length > 0) pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  draw();

  return stop;
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

// A hunt that exists but has not started (opened by its ?event= link).
export function renderNotStarted(container: HTMLElement): void {
  injectStyles();
  container.textContent = "";

  const message = element("p", "huntry-cards-message", "This hunt hasn't started yet. Come back once it goes live! ");
  const back = element("a", "", "Back to all hunts");

  back.href = listingUrl();
  message.appendChild(back);
  container.appendChild(message);
}
