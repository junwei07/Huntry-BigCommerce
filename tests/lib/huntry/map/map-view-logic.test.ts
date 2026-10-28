import { describe, expect, it } from "vitest";
import { buildEggInfoLines } from "@/lib/huntry/map/egg-info";
import { buildRadiusFeatureCollection } from "@/lib/huntry/map/radius-overlay";
import { buildRewardChoices } from "@/lib/huntry/map/reward-choices";
import { resolveMapClick } from "@/lib/huntry/map/placement-click";
import { MAX_EGGS_PER_EVENT, MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import type { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import type { HuntryReward } from "@/lib/huntry/rewards/types";

const reward = (id: number, overrides: Partial<HuntryReward> = {}): HuntryReward =>
  ({ id, name: `Reward ${id}`, sponsorId: null, eggCapacity: 5, ...overrides }) as HuntryReward;

const egg = (overrides: Partial<HuntryEgg> = {}): HuntryEgg =>
  ({ id: "egg-1", rewardId: 1, name: "", lat: 1.3, lng: 103.8, ...overrides }) as HuntryEgg;

const queued = (key: string, rewardId: number, lat = 0, lng = 0): PendingEgg => ({ key, rewardId, name: "", lat, lng });

describe("buildEggInfoLines", () => {
  const base = {
    rewards: [reward(1, { name: "Coffee", sponsorId: 9, eggCapacity: 10 })],
    rewardEggCounts: { 1: 4 },
    sponsorNames: { 9: "Acme" },
    pending: [] as PendingEgg[],
    claimCapacity: 3,
    claimCounts: { "egg-1": { count: 2, forced: 0 } },
  };

  it("lists reward, sponsor, eggs placed, claims and coordinates", () => {
    expect(buildEggInfoLines(egg(), base)).toEqual({
      title: "Coffee",
      lines: [
        "Reward: Coffee",
        "Sponsor: Acme",
        "Eggs Placed: 4/10",
        "Claims: 2/3",
        "Lat: 1.300000, Lng: 103.800000",
      ],
    });
  });

  it("counts the reward's queued eggs in Eggs Placed", () => {
    const { lines } = buildEggInfoLines(egg(), { ...base, pending: [queued("a", 1), queued("b", 1), queued("c", 2)] });

    expect(lines).toContain("Eggs Placed: 6/10");
  });

  it("prefers the egg's own name for the title", () => {
    expect(buildEggInfoLines(egg({ name: "Park egg" }), base).title).toBe("Park egg");
  });

  it("handles an unknown reward, no sponsor and no claims", () => {
    expect(buildEggInfoLines(egg({ rewardId: 99 }), { ...base, claimCounts: {} })).toEqual({
      title: "Unnamed egg",
      lines: ["Reward: Unknown reward", "Sponsor: -", "Claims: 0/3", "Lat: 1.300000, Lng: 103.800000"],
    });
  });
});

describe("buildRewardChoices", () => {
  const rewards = [reward(1, { eggCapacity: 5, sponsorId: 9 }), reward(2, { eggCapacity: 100 })];

  it("subtracts saved and queued eggs from the capacity", () => {
    const choices = buildRewardChoices(rewards, { 1: 3 }, [queued("a", 1)], { 9: "Acme" }, null);

    expect(choices[0]).toMatchObject({ remaining: 1, selectable: true, sponsorName: "Acme" });
  });

  it("caps the capacity at MAX_EGGS_PER_REWARD", () => {
    const [, bigReward] = buildRewardChoices(rewards, {}, [], {}, null);

    expect(bigReward.remaining).toBe(MAX_EGGS_PER_REWARD);
    expect(bigReward.sponsorName).toBeNull();
  });

  it("makes a full reward unselectable, except the one the edited egg already holds", () => {
    const full = { 1: 5 };

    expect(buildRewardChoices(rewards, full, [], {}, null)[0]).toMatchObject({ remaining: 0, selectable: false });
    expect(buildRewardChoices(rewards, full, [], {}, 1)[0]).toMatchObject({ remaining: 0, selectable: true });
  });

  it("never reports a negative remaining count", () => {
    expect(buildRewardChoices(rewards, { 1: 9 }, [], {}, null)[0].remaining).toBe(0);
  });

  it("shows no sponsor name when the sponsor is missing from the lookup", () => {
    expect(buildRewardChoices([reward(1, { sponsorId: 7 })], {}, [], {}, null)[0].sponsorName).toBeNull();
  });
});

describe("buildRadiusFeatureCollection", () => {
  it("makes one closed polygon ring per center", () => {
    const data = buildRadiusFeatureCollection([{ lat: 1.3, lng: 103.8 }, { lat: 1.31, lng: 103.81 }], 20);

    expect(data).toMatchObject({ type: "FeatureCollection" });

    const features = (data as { features: { geometry: { type: string; coordinates: number[][][] } }[] }).features;

    expect(features).toHaveLength(2);
    expect(features[0].geometry.type).toBe("Polygon");

    const ring = features[0].geometry.coordinates[0];

    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("is empty with no centers", () => {
    expect(buildRadiusFeatureCollection([], 20)).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("resolveMapClick", () => {
  const point = { lat: 1.3, lng: 103.8 };
  const base = {
    isPlacing: true,
    isEditingLocation: false,
    hasDialog: false,
    clickedOnOverlay: false,
    point,
    eggs: [] as { lat: number; lng: number }[],
    pending: [] as { lat: number; lng: number }[],
    markerRadiusMeters: 50,
  };

  it("opens the place dialog at the clicked point", () => {
    expect(resolveMapClick(base)).toEqual({ kind: "place", ...point });
  });

  it.each([
    ["not placing", { isPlacing: false }],
    ["editing a location", { isEditingLocation: true }],
    ["a dialog is already open", { hasDialog: true }],
    ["the click landed on a marker or popup", { clickedOnOverlay: true }],
  ])("ignores the click when %s", (_label, override) => {
    expect(resolveMapClick({ ...base, ...override })).toBeNull();
  });

  it("opens the limit dialog at the event egg cap, counting queued eggs", () => {
    const eggs = Array.from({ length: MAX_EGGS_PER_EVENT - 1 }, (_, index) => ({ lat: 10 + index, lng: 0 }));

    expect(resolveMapClick({ ...base, eggs })).toEqual({ kind: "place", ...point });
    expect(resolveMapClick({ ...base, eggs, pending: [{ lat: -50, lng: 0 }] })).toEqual({ kind: "limit" });
  });

  it("opens the proximity dialog when too close to a saved or queued egg", () => {
    const near = { lat: point.lat + 0.0001, lng: point.lng };

    expect(resolveMapClick({ ...base, eggs: [near] })).toEqual({ kind: "proximity" });
    expect(resolveMapClick({ ...base, pending: [near] })).toEqual({ kind: "proximity" });
  });

  it("checks the cap before the spacing", () => {
    const eggs = Array.from({ length: MAX_EGGS_PER_EVENT }, () => ({ lat: point.lat, lng: point.lng }));

    expect(resolveMapClick({ ...base, eggs })).toEqual({ kind: "limit" });
  });
});
