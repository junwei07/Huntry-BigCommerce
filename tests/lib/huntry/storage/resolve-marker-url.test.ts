import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/storage", () => ({ getStorageBucketName: () => "test-bucket" }));
vi.mock("@/lib/bc-api-client/resolve-store-credentials", () => ({
  resolveStoreHash: (hash: string | undefined) => hash,
}));

import { buildDownloadUrl } from "@/lib/huntry/storage/image-urls";
import { resolveEventMarkers, resolveMarkerUrl } from "@/lib/huntry/storage/resolve-image-field";

const own = buildDownloadUrl("test-bucket", "abc/event-item-marker/1.png", "tok");
const other = buildDownloadUrl("test-bucket", "zzz/event-item-marker/1.png", "tok");

describe("resolveMarkerUrl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps empty to null, never keeping the current value", () => {
    expect(resolveMarkerUrl({ submitted: "", current: own, storeHash: "abc" })).toEqual({ ok: true, url: null });
    expect(resolveMarkerUrl({ submitted: null, current: own, storeHash: "abc" })).toEqual({ ok: true, url: null });
  });

  it("accepts this store's upload and an unchanged legacy URL", () => {
    expect(resolveMarkerUrl({ submitted: own, current: null, storeHash: "abc" })).toEqual({ ok: true, url: own });
    expect(resolveMarkerUrl({ submitted: "https://x.test/a.png", current: "https://x.test/a.png", storeHash: "abc" })).toEqual({
      ok: true,
      url: "https://x.test/a.png",
    });
  });

  it("rejects other stores, new external URLs, scripts and placeholders", () => {
    for (const submitted of [other, "https://x.test/a.png", "javascript:alert(1)", "/huntry/markers/item/sample_1.png"]) {
      expect(resolveMarkerUrl({ submitted, current: null, storeHash: "abc" })).toEqual({ ok: false });
    }
  });
});

describe("resolveEventMarkers", () => {
  it("forces preset markers' URLs to null", () => {
    const result = resolveEventMarkers({
      itemMarker: { source: "preset", presetIndex: 2, unclaimedIconUrl: own, claimedIconUrl: own },
      locationMarker: { source: "preset", presetIndex: 1, iconUrl: own },
      current: undefined,
      storeHash: "abc",
    });

    expect(result).toEqual({
      ok: true,
      itemMarker: { source: "preset", presetIndex: 2, unclaimedIconUrl: null, claimedIconUrl: null },
      locationMarker: { source: "preset", presetIndex: 1, iconUrl: null },
    });
  });

  it("fails when a custom URL belongs to another store", () => {
    expect(
      resolveEventMarkers({
        itemMarker: { source: "custom", presetIndex: null, unclaimedIconUrl: other, claimedIconUrl: null },
        locationMarker: { source: "preset", presetIndex: null, iconUrl: null },
        current: undefined,
        storeHash: "abc",
      }),
    ).toEqual({ ok: false });
  });
});
