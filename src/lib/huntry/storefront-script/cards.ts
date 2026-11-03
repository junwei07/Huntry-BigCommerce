import { formatCountdown } from "./map-utils";
import { StorefrontEvent, StorefrontUpcomingEvent } from "./types";

// View-model for one event card on the /huntry/ listing (the WordPress
// plugin's huntry_render_event_cards_listing). Live events and upcoming ones
// (card data only, no eggs) reach the storefront; ended ones never do.
export interface EventCard {
  status: "live" | "upcoming";
  slug: string;
  name: string;
  description: string;
  bannerUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

function toTime(value: string | null): number | null {
  if (!value) return null;

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

// Within a group: earliest start first; events with no start date last, then
// by name so the order is stable.
function byStart(a: EventCard, b: EventCard): number {
  const aStart = toTime(a.startsAt);
  const bStart = toTime(b.startsAt);

  if (aStart !== bStart) {
    if (aStart === null) return 1;
    if (bStart === null) return -1;

    return aStart - bStart;
  }

  return a.name.localeCompare(b.name);
}

// Live cards first, then upcoming ones (the plugin's listing order).
export function buildCards(live: StorefrontEvent[], upcoming: StorefrontUpcomingEvent[] = []): EventCard[] {
  const toCard = (event: StorefrontEvent | StorefrontUpcomingEvent, status: EventCard["status"]): EventCard => ({
    status,
    slug: event.slug,
    name: event.name,
    description: event.description,
    bannerUrl: event.headerBannerUrl,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  });

  return [
    ...live.map((event) => toCard(event, "live")).sort(byStart),
    ...upcoming.map((event) => toCard(event, "upcoming")).sort(byStart),
  ];
}

export function formatDateRange(
  startsAt: string | null,
  endsAt: string | null,
  locale?: string,
  timeZone?: string,
): string {
  const format = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone });
  const start = toTime(startsAt);
  const end = toTime(endsAt);

  if (start !== null && end !== null) return `${format.format(start)} – ${format.format(end)}`;
  if (end !== null) return `Until ${format.format(end)}`;
  if (start !== null) return `From ${format.format(start)}`;

  return "";
}

// "Ends in 02h 03m 04s" while running, "Hunt ended" once past, null with no
// end date.
export function endsCountdown(endsAt: string | null, now: number): string | null {
  const end = toTime(endsAt);

  if (end === null) return null;
  if (end <= now) return "Hunt ended";

  return `Ends in ${formatCountdown(end - now)}`;
}

// "Starts in 02d 03h 04m 05s" before the start; "Starting now" once it has
// passed (the card turns into a live one when the data is refetched), null with
// no start date.
export function startsCountdown(startsAt: string | null, now: number): string | null {
  const start = toTime(startsAt);

  if (start === null) return null;
  if (start <= now) return "Starting now";

  return `Starts in ${formatCountdown(start - now)}`;
}
