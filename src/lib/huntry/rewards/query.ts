import { RewardsQuery, RewardSort } from "@/lib/huntry/rewards/types";

export const DEFAULT_QUERY: RewardsQuery = {
  sort: "name",
};

export const REWARD_SORT_OPTIONS: { value: RewardSort; content: string }[] = [
  { value: "name", content: "A-Z" },
  { value: "time", content: "Time (soonest first)" },
];

type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseRewardsQuery(searchParams: RawSearchParams): RewardsQuery {
  const sortParam = getParam(searchParams, "sort");
  const sort: RewardSort = sortParam === "name" || sortParam === "time" ? sortParam : DEFAULT_QUERY.sort;

  return { sort };
}

export function buildRewardsSearchParams(query: RewardsQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (query.sort !== DEFAULT_QUERY.sort) {
    params.set("sort", query.sort);
  }

  return params;
}
