import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getStorageBucketName } from "@/lib/firebase/storage";
import type { EventItemMarker, EventLocationMarker, EventTheme } from "@/lib/huntry/events/types";
import { resolveSubmittedImageUrl } from "@/lib/huntry/storage/image-urls";

export const INVALID_IMAGE_MESSAGE = "That image was not uploaded for this store. Upload it again.";

// Marker icons differ from banners/logos: empty means "no custom icon"
// (null), never "keep the current one" or a placeholder. An unchanged value
// passes so events saved with a legacy external URL keep saving; anything new
// must be an object this store uploaded.
export function resolveMarkerUrl(params: {
  submitted: string | null | undefined;
  current: string | null | undefined;
  storeHash: string | undefined;
}): { ok: true; url: string | null } | { ok: false } {
  const value = params.submitted?.trim() ?? "";

  if (value === "") {
    return { ok: true, url: null };
  }

  if (value === (params.current ?? null)) {
    return { ok: true, url: value };
  }

  const resolved = resolveSubmittedImageUrl({
    submitted: value,
    current: null,
    fallback: "",
    storeHash: resolveStoreHash(params.storeHash),
    bucket: getStorageBucketName(),
  });

  // A bundled placeholder path is valid for banners but not an uploaded icon.
  if (!resolved.ok || resolved.url.startsWith("/")) {
    return { ok: false };
  }

  return { ok: true, url: resolved.url };
}

// The Server Actions' one entry point for an image URL posted by a form:
// binds resolveSubmittedImageUrl to the resolved store and configured bucket.
export function resolveImageField(params: {
  submitted: string | undefined;
  current: string | null;
  fallback: string;
  storeHash: string | undefined;
}): { ok: true; url: string } | { ok: false } {
  return resolveSubmittedImageUrl({
    submitted: params.submitted,
    current: params.current,
    fallback: params.fallback,
    storeHash: resolveStoreHash(params.storeHash),
    bucket: getStorageBucketName(),
  });
}

// Every custom marker URL an event theme references, for cleanup diffs.
export function markerUrlsOf(theme: Pick<EventTheme, "itemMarker" | "locationMarker"> | undefined): string[] {
  return [
    theme?.itemMarker?.unclaimedIconUrl,
    theme?.itemMarker?.claimedIconUrl,
    theme?.locationMarker?.iconUrl,
  ].filter((url): url is string => Boolean(url));
}

// Validates both marker sections of a submitted event form. A preset forces
// its URLs to null so a stale custom icon can't linger.
export function resolveEventMarkers(params: {
  itemMarker: EventItemMarker;
  locationMarker: EventLocationMarker;
  current: Pick<EventTheme, "itemMarker" | "locationMarker"> | undefined;
  storeHash: string | undefined;
}): { ok: true; itemMarker: EventItemMarker; locationMarker: EventLocationMarker } | { ok: false } {
  const { itemMarker, locationMarker, current, storeHash } = params;
  const resolve = (submitted: string | null, existing: string | null | undefined) =>
    resolveMarkerUrl({ submitted, current: existing, storeHash });

  const custom = (marker: { source: string }) => marker.source === "custom";
  const unclaimed = custom(itemMarker)
    ? resolve(itemMarker.unclaimedIconUrl, current?.itemMarker?.unclaimedIconUrl)
    : { ok: true as const, url: null };
  const claimed = custom(itemMarker)
    ? resolve(itemMarker.claimedIconUrl, current?.itemMarker?.claimedIconUrl)
    : { ok: true as const, url: null };
  const icon = custom(locationMarker)
    ? resolve(locationMarker.iconUrl, current?.locationMarker?.iconUrl)
    : { ok: true as const, url: null };

  if (!unclaimed.ok || !claimed.ok || !icon.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    itemMarker: { ...itemMarker, unclaimedIconUrl: unclaimed.url, claimedIconUrl: claimed.url },
    locationMarker: { ...locationMarker, iconUrl: icon.url },
  };
}
