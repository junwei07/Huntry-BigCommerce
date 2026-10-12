import { describe, expect, it } from "vitest";
import { createNearbyTracker, evaluateNearby } from "@/lib/huntry/storefront-script/map/egg-nearby";
import { describeGeolocationError } from "@/lib/huntry/storefront-script/map/geolocation";
import { markerAppearance } from "@/lib/huntry/storefront-script/map/marker-state";
import { initialView, pickEvent } from "@/lib/huntry/storefront-script/map/view";
import { nearestUnclaimedDistance } from "@/lib/huntry/storefront-script/proximity";
import { EggFlags, StorefrontEgg, StorefrontEvent } from "@/lib/huntry/storefront-script/types";

const egg = (id: string, lat: number, lng: number, isFull = false): StorefrontEgg => ({
  id,
  name: id,
  lat,
  lng,
  rewardName: "r",
  isFull,
});

const event = (slug: string, eggs: StorefrontEgg[] = []): StorefrontEvent => ({
  id: 1,
  name: slug,
  slug,
  description: "",
  startsAt: null,
  endsAt: null,
  headerBannerUrl: null,
  markerRadiusMeters: 50,
  maxGrabCount: 0,
  eggClaimCapacity: 1,
  colors: { primaryColor: "#f7a163", successColor: "#5dc564" },
  unclaimedIconUrl: "https://app/u.png",
  claimedIconUrl: "https://app/c.png",
  locationIconUrl: null,
  locationAnchor: "bottom",
  eggs,
});

const flags = (overrides: Partial<Record<keyof EggFlags, string[]>> = {}): EggFlags => ({
  skipped: new Set(overrides.skipped),
  dismissed: new Set(overrides.dismissed),
  claimedDismissed: new Set(overrides.claimedDismissed),
  mine: new Set(overrides.mine),
});

describe("describeGeolocationError", () => {
  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
    [99, "unavailable"],
    [null, "unsupported"],
  ])("code %s -> %s", (code, kind) => {
    const problem = describeGeolocationError(code);

    expect(problem.kind).toBe(kind);
    expect(problem.message.length).toBeGreaterThan(0);
  });
});

describe("pickEvent / initialView", () => {
  it("prefers the slug, falls back to the first event, and handles none", () => {
    const events = [event("a"), event("b")];

    expect(pickEvent(events, "b")?.slug).toBe("b");
    expect(pickEvent(events, "missing")?.slug).toBe("a");
    expect(pickEvent(events)?.slug).toBe("a");
    expect(pickEvent([])).toBeNull();
  });

  it("centres on the eggs' centroid at zoom 14, or the world with no eggs", () => {
    expect(initialView(event("a", [egg("1", 10, 20), egg("2", 20, 40)]))).toEqual({ center: [30, 15], zoom: 14 });
    expect(initialView(event("a")).zoom).toBeLessThan(5);
  });
});

describe("markerAppearance", () => {
  const ev = event("a");

  it("uses the claimed icon and grey pin once an egg is full or mine", () => {
    expect(markerAppearance(egg("1", 0, 0, true), ev, new Set())).toEqual({
      claimed: true,
      iconUrl: "https://app/c.png",
      fallbackColor: "#999999",
    });
    expect(markerAppearance(egg("1", 0, 0), ev, new Set(["1"])).claimed).toBe(true);
  });

  it("uses the item icon and orange pin when unclaimed, and null with no icon configured", () => {
    expect(markerAppearance(egg("1", 0, 0), ev, new Set())).toEqual({
      claimed: false,
      iconUrl: "https://app/u.png",
      fallbackColor: "#eb711b",
    });
    expect(markerAppearance(egg("1", 0, 0), { ...ev, unclaimedIconUrl: null }, new Set()).iconUrl).toBeNull();
  });
});

describe("evaluateNearby / createNearbyTracker", () => {
  const eggs = [egg("near", 0.0001, 0), egg("full", 0, 0.0001, true)];

  it("prefers a claimable egg, then an unseen claimed one, then a revisitable one", () => {
    expect(evaluateNearby(eggs, 0, 0, 50, flags())?.kind).toBe("claimable");
    expect(evaluateNearby(eggs, 0, 0, 50, flags({ dismissed: ["near"] }))?.kind).toBe("claimed-unseen");
    expect(
      evaluateNearby(eggs, 0, 0, 50, flags({ dismissed: ["near"], claimedDismissed: ["full"], skipped: ["near"] }))?.kind,
    ).toBe("revisitable");
    expect(evaluateNearby(eggs, 0, 0, 1, flags())).toBeNull();
  });

  it("emits once per approach and re-arms when the player leaves or rearm() is called", () => {
    const tracker = createNearbyTracker();
    const here = evaluateNearby(eggs, 0, 0, 50, flags());

    expect(tracker.next(here).nearby?.egg.id).toBe("near");
    expect(tracker.next(here)).toEqual({ changed: false, nearby: null });
    expect(tracker.next(here).changed).toBe(false);
    // Leaving the radius is a change to "nothing", so the bell badge can clear.
    expect(tracker.next(null)).toEqual({ changed: true, nearby: null });
    expect(tracker.next(null).changed).toBe(false);
    expect(tracker.next(here).nearby?.egg.id).toBe("near");

    tracker.rearm();

    expect(tracker.next(here).nearby?.egg.id).toBe("near");
  });

  it("reports a change when only the revisitable egg changes", () => {
    const tracker = createNearbyTracker();
    const both = [egg("a", 0.0001, 0), egg("b", 0, 0.0001)];

    expect(tracker.next(evaluateNearby(both, 0, 0, 50, flags())).changed).toBe(true);
    // "a" is skipped: it stops being claimable and "b" stays the primary egg, but the
    // bell now has something to reopen.
    const afterSkip = evaluateNearby(both, 0, 0, 50, flags({ skipped: ["a"], dismissed: ["a"] }));

    expect(afterSkip?.kind).toBe("claimable");
    expect(afterSkip?.revisitable?.egg.id).toBe("a");
    expect(tracker.next(afterSkip).changed).toBe(true);
  });
});

describe("nearestUnclaimedDistance", () => {
  it("ignores claimed eggs and returns null when nothing is left", () => {
    const eggs = [egg("a", 0.001, 0), egg("b", 0.0001, 0, true)];

    expect(nearestUnclaimedDistance(eggs, 0, 0, flags())).toBeGreaterThan(100);
    expect(nearestUnclaimedDistance(eggs, 0, 0, flags({ mine: ["a"] }))).toBeNull();
  });
});
