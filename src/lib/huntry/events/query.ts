import { EventsQuery, EventSort } from "@/lib/huntry/events/types";

export const DEFAULT_QUERY: EventsQuery = {
  sort: "time",
};

export const EVENT_SORT_OPTIONS: { value: EventSort; content: string }[] = [
  { value: "name", content: "A-Z" },
  { value: "time", content: "Time (soonest first)" },
];

type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseEventsQuery(searchParams: RawSearchParams): EventsQuery {
  const sortParam = getParam(searchParams, "sort");
  const sort: EventSort = sortParam === "name" || sortParam === "time" ? sortParam : DEFAULT_QUERY.sort;

  return { sort };
}

export function buildEventsSearchParams(query: EventsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.sort !== DEFAULT_QUERY.sort) {
    params.set("sort", query.sort);
  }

  return params;
}
