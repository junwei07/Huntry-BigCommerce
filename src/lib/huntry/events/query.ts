import { EventsQuery, SortDirection } from "@/lib/huntry/events/types";

export const DEFAULT_QUERY: EventsQuery = {
  direction: "ASC",
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseEventsQuery(searchParams: RawSearchParams): EventsQuery {
  const directionParam = getParam(searchParams, "direction");
  const direction: SortDirection = directionParam === "DESC" ? "DESC" : DEFAULT_QUERY.direction;

  return { direction };
}

export function buildEventsSearchParams(query: EventsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.direction !== DEFAULT_QUERY.direction) {
    params.set("direction", query.direction);
  }

  return params;
}
