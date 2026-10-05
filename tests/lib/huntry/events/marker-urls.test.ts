import { describe, expect, it } from "vitest";
import {
  locationMarkerAnchor,
  resolveItemMarkerUrl,
  resolveLocationMarkerUrl,
} from "@/lib/huntry/events/marker-urls";
import { DEFAULT_ITEM_MARKER, DEFAULT_LOCATION_MARKER } from "@/lib/huntry/events/types";

describe("marker url resolution", () => {
  it("returns null when no marker is configured", () => {
    expect(resolveItemMarkerUrl(DEFAULT_ITEM_MARKER)).toBeNull();
    expect(resolveLocationMarkerUrl(DEFAULT_LOCATION_MARKER)).toBeNull();
  });

  it("resolves preset urls", () => {
    expect(resolveItemMarkerUrl({ ...DEFAULT_ITEM_MARKER, presetIndex: 3 })).toBe("/huntry/markers/item/sample_3.png");
    expect(resolveLocationMarkerUrl({ ...DEFAULT_LOCATION_MARKER, presetIndex: 2 })).toBe(
      "/huntry/markers/location/current_marker_2.png",
    );
  });

  it("resolves custom urls and treats blanks as unset", () => {
    expect(
      resolveItemMarkerUrl({ source: "custom", presetIndex: null, unclaimedIconUrl: "https://x/a.png", claimedIconUrl: null }),
    ).toBe("https://x/a.png");
    expect(resolveLocationMarkerUrl({ source: "custom", presetIndex: null, iconUrl: null })).toBeNull();
  });

  it("anchors only location preset 1 at the bottom", () => {
    expect(locationMarkerAnchor({ ...DEFAULT_LOCATION_MARKER, presetIndex: 1 })).toBe("bottom");
    expect(locationMarkerAnchor({ ...DEFAULT_LOCATION_MARKER, presetIndex: 2 })).toBe("center");
    expect(locationMarkerAnchor({ source: "custom", presetIndex: 1, iconUrl: "u" })).toBe("center");
  });
});
