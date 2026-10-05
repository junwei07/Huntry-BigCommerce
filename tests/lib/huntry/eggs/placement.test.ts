import { describe, expect, it } from "vitest";
import { MAX_EGGS_PER_EVENT } from "@/lib/huntry/eggs/limits";
import { planEggPlacements } from "@/lib/huntry/eggs/placement";

// ~0.001 degrees of latitude is ~111m — comfortably beyond a 20m radius.
const at = (step: number) => ({ lat: 59 + step * 0.001, lng: 18 });
const add = (rewardId: number, step: number, name = "") => ({ rewardId, name, ...at(step) });

const base = {
  eventName: "Spring Hunt",
  markerRadiusMeters: 20,
  existingEggs: [],
  rewardCapacities: new Map([
    [1, 3],
    [2, 3],
  ]),
  rewardEggCounts: new Map<number, number>(),
};

describe("planEggPlacements", () => {
  it("auto-names blank names '<Event> <N>' continuing from the event's egg count, keeping typed names", () => {
    const plan = planEggPlacements({
      ...base,
      existingEggs: [at(100), at(101)],
      adds: [add(1, 0), add(1, 1, "Typed"), add(1, 2)],
    });

    expect(plan.accepted.map((egg) => egg.name)).toEqual(["Spring Hunt 3", "Typed", "Spring Hunt 4"]);
  });

  it("skips an add too close to an existing egg or to one accepted earlier in the batch", () => {
    const plan = planEggPlacements({ ...base, existingEggs: [at(0)], adds: [add(1, 0), add(1, 1), add(1, 1)] });

    expect(plan.accepted).toHaveLength(1);
    expect(plan.skippedTooClose).toBe(2);
  });

  it("enforces per-reward capacity using the reward's eggs across every event", () => {
    const plan = planEggPlacements({
      ...base,
      rewardEggCounts: new Map([[1, 2]]),
      adds: [add(1, 0), add(1, 1), add(2, 2)],
    });

    expect(plan.accepted.map((egg) => egg.rewardId)).toEqual([1, 2]);
    expect(plan.skippedNoCapacity).toBe(1);
  });

  it("enforces the independent event cap across rewards", () => {
    const capacities = new Map([[1, 30], [2, 30]]);
    const existing = Array.from({ length: MAX_EGGS_PER_EVENT - 1 }, (_, index) => at(100 + index));
    const plan = planEggPlacements({
      ...base,
      rewardCapacities: capacities,
      existingEggs: existing,
      adds: [add(1, 0), add(2, 1)],
    });

    expect(plan.accepted).toHaveLength(1);
    expect(plan.skippedNoCapacity).toBe(1);
  });

  it("rejects adds for an unknown reward", () => {
    const plan = planEggPlacements({ ...base, adds: [add(99, 0)] });

    expect(plan.accepted).toHaveLength(0);
    expect(plan.skippedNoCapacity).toBe(1);
  });
});
