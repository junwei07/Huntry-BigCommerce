import { describe, expect, it } from "vitest";
import { summarizeEventRewards, summarizeRewards } from "@/lib/huntry/rewards/summary";

const rewards = [
  { id: 1, eggCapacity: 5 },
  { id: 2, eggCapacity: 3 },
  { id: 3, eggCapacity: 10 },
];

describe("summarizeRewards", () => {
  it("sums capacity and placements across every event", () => {
    expect(summarizeRewards(rewards, new Map([[1, 2], [2, 3]]))).toEqual({
      totalRewards: 3,
      totalCapacity: 18,
      placed: 5,
      remaining: 13,
    });
  });

  it("returns zeros with no rewards and never goes negative", () => {
    expect(summarizeRewards([], new Map())).toEqual({ totalRewards: 0, totalCapacity: 0, placed: 0, remaining: 0 });
    expect(summarizeRewards([{ id: 1, eggCapacity: 1 }], new Map([[1, 4]])).remaining).toBe(0);
  });
});

describe("summarizeEventRewards", () => {
  it("counts a reward's full capacity once and skips rewards with no egg in the event", () => {
    const eggs = [{ rewardId: 1 }, { rewardId: 1 }, { rewardId: 2 }];

    expect(summarizeEventRewards(rewards, eggs)).toEqual({ totalPlaced: 3, totalCapacity: 8, rewardCount: 2 });
  });

  it("returns zeros for an event with no eggs", () => {
    expect(summarizeEventRewards(rewards, [])).toEqual({ totalPlaced: 0, totalCapacity: 0, rewardCount: 0 });
  });
});
