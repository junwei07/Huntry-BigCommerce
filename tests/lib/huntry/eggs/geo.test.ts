import { describe, expect, it } from "vitest";
import { circleRing, haversineMeters, isFarEnough, isValidCoordinate } from "@/lib/huntry/eggs/geo";

const STOCKHOLM = { lat: 59.3293, lng: 18.0686 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(STOCKHOLM, STOCKHOLM)).toBe(0);
  });

  it("measures ~111km per degree of latitude", () => {
    const distance = haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });

    expect(distance).toBeGreaterThan(111000);
    expect(distance).toBeLessThan(111400);
  });
});

describe("isFarEnough", () => {
  // ~0.0002 degrees of latitude is ~22m.
  const near = { lat: STOCKHOLM.lat + 0.0002, lng: STOCKHOLM.lng };

  it("accepts a point beyond the radius and rejects one inside it", () => {
    expect(isFarEnough(near, [STOCKHOLM], 20)).toBe(true);
    expect(isFarEnough(near, [STOCKHOLM], 30)).toBe(false);
  });

  it("treats exactly-at-radius as far enough (>=), and an empty list as always fine", () => {
    const exact = haversineMeters(STOCKHOLM, near);

    expect(isFarEnough(near, [STOCKHOLM], exact)).toBe(true);
    expect(isFarEnough(near, [], 1000)).toBe(true);
  });
});

describe("isValidCoordinate", () => {
  it("enforces the lat/lng bounds and rejects NaN", () => {
    expect(isValidCoordinate(STOCKHOLM)).toBe(true);
    expect(isValidCoordinate({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoordinate({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidCoordinate({ lat: Number.NaN, lng: 0 })).toBe(false);
  });
});

describe("circleRing", () => {
  it("returns a closed ring whose points sit at the requested radius", () => {
    const ring = circleRing(STOCKHOLM, 50);

    expect(ring[0]).toEqual(ring[ring.length - 1]);

    for (const [lng, lat] of ring) {
      expect(haversineMeters(STOCKHOLM, { lat, lng })).toBeCloseTo(50, 0);
    }
  });
});
