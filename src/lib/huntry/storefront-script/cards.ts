import { formatCountdown } from "./map-utils";
import { StorefrontEvent } from "./types";

// View-model for one event card on the /huntry/ listing (the WordPress
// plugin's huntry_render_event_cards_listing). Only live events reach the
// storefront: map-data deliberately hides upcoming and ended ones.
export interface EventCard {
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

// Earliest start first; events with no start date last, then by name so the
// order is stable.
export function buildCards(events: StorefrontEvent[]): EventCard[] {
  return events
    .map((event) => ({
      slug: event.slug,
      name: event.name,
      description: event.description,
      bannerUrl: event.headerBannerUrl,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    }))
    .sort((a, b) => {
      const aStart = toTime(a.startsAt);
      const bStart = toTime(b.startsAt);

      if (aStart !== bStart) {
        if (aStart === null) return 1;
        if (bStart === null) return -1;

        return aStart - bStart;
      }

      return a.name.localeCompare(b.name);
    });
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
