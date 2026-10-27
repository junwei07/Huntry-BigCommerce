import { SponsorsQuery, SortDirection } from "@/lib/huntry/sponsors/types";

export const DEFAULT_QUERY: SponsorsQuery = {
  direction: "ASC",
};

export const SPONSOR_SORT_OPTIONS: { value: SortDirection; content: string }[] = [
  { value: "ASC", content: "A-Z" },
];

type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseSponsorsQuery(searchParams: RawSearchParams): SponsorsQuery {
  const directionParam = getParam(searchParams, "direction");
  const direction: SortDirection = directionParam === "DESC" ? "DESC" : DEFAULT_QUERY.direction;

  return { direction };
}

export function buildSponsorsSearchParams(query: SponsorsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.direction !== DEFAULT_QUERY.direction) {
    params.set("direction", query.direction);
  }

  return params;
}
