import { describe, expect, it } from "vitest";
import { formatCountdown, haversineMeters } from "@/lib/huntry/storefront-script/map-utils";
import {
  findClaimableEgg,
  findNearbyRevisitableEgg,
  findUnseenClaimedEgg,
} from "@/lib/huntry/storefront-script/proximity";
import { EggFlags, StorefrontEgg } from "@/lib/huntry/storefront-script/types";

const egg = (id: string, lat: number, lng: number, isFull = false): StorefrontEgg => ({
  id,
  name: id,
  lat,
  lng,
  rewardName: "r",
  isFull,
});

const noFlags = (overrides: Partial<Record<keyof EggFlags, string[]>> = {}): EggFlags => ({
  skipped: new Set(overrides.skipped),
  dismissed: new Set(overrides.dismissed),
  claimedDismissed: new Set(overrides.claimedDismissed),
  mine: new Set(overrides.mine),
});

// ~0.0001 degrees of latitude is ~11 m.
const NEAR = 0.0001;
const FAR = 0.01;

describe("haversineMeters", () => {
  it("is zero for the same point and ~111 km per degree of latitude", () => {
    expect(haversineMeters(10, 20, 10, 20)).toBe(0);
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(111000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(111400);
  });
});

describe("formatCountdown", () => {
  it("drops leading zero units and clamps at zero", () => {
    expect(formatCountdown(-5000)).toBe("00s");
    expect(formatCountdown(65_000)).toBe("01m 05s");
    expect(formatCountdown(3_700_000)).toBe("01h 01m 40s");
    expect(formatCountdown(90_061_000)).toBe("01d 01h 01m 01s");
  });
});

describe("proximity", () => {
  const eggs = [egg("near", NEAR, 0), egg("nearer", NEAR / 2, 0), egg("far", FAR, 0), egg("full", 0, NEAR, true)];

  it("findClaimableEgg picks the closest unclaimed, undismissed egg in range", () => {
    expect(findClaimableEgg(eggs, 0, 0, 50, noFlags())?.egg.id).toBe("nearer");
    expect(findClaimableEgg(eggs, 0, 0, 50, noFlags({ dismissed: ["nearer"] }))?.egg.id).toBe("near");
    expect(findClaimableEgg(eggs, 0, 0, 50, noFlags({ mine: ["nearer", "near"] }))).toBeNull();
    expect(findClaimableEgg(eggs, 0, 0, 1, noFlags())).toBeNull();
  });

  it("findUnseenClaimedEgg only returns others' full eggs not yet dismissed", () => {
    expect(findUnseenClaimedEgg(eggs, 0, 0, 50, noFlags())?.egg.id).toBe("full");
    expect(findUnseenClaimedEgg(eggs, 0, 0, 50, noFlags({ claimedDismissed: ["full"] }))).toBeNull();
    expect(findUnseenClaimedEgg(eggs, 0, 0, 50, noFlags({ mine: ["full"] }))).toBeNull();
  });

  it("findNearbyRevisitableEgg covers skipped, claimed-dismissed and mine", () => {
    expect(findNearbyRevisitableEgg(eggs, 0, 0, 50, noFlags())).toBeNull();
    expect(findNearbyRevisitableEgg(eggs, 0, 0, 50, noFlags({ skipped: ["near"] }))?.egg.id).toBe("near");
    expect(findNearbyRevisitableEgg(eggs, 0, 0, 50, noFlags({ claimedDismissed: ["full"] }))?.egg.id).toBe("full");
    expect(findNearbyRevisitableEgg(eggs, 0, 0, 50, noFlags({ mine: ["nearer"] }))?.egg.id).toBe("nearer");
    // Skipped only counts while the egg is still claimable.
    expect(findNearbyRevisitableEgg(eggs, 0, 0, 50, noFlags({ skipped: ["full"] }))).toBeNull();
  });
});
