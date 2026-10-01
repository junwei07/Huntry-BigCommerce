import { RewardsQuery, SortDirection } from "@/lib/huntry/rewards/types";

export const DEFAULT_QUERY: RewardsQuery = {
  direction: "ASC",
};

type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseRewardsQuery(searchParams: RawSearchParams): RewardsQuery {
  const directionParam = getParam(searchParams, "direction");
  const direction: SortDirection = directionParam === "DESC" ? "DESC" : DEFAULT_QUERY.direction;

  return { direction };
}

export function buildRewardsSearchParams(query: RewardsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.direction !== DEFAULT_QUERY.direction) {
    params.set("direction", query.direction);
  }

  return params;
}
