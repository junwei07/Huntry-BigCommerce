import {
  EventItemMarker,
  EventLocationMarker,
  getItemMarkerPresetUrls,
  getLocationMarkerPresetUrl,
} from "@/lib/huntry/events/types";

// Port of huntry_resolve_event_marker_url() (huntry/includes/events/index.php).
// null means "no marker configured" — the map keeps its default pin.
export function resolveItemMarkerUrl(marker: EventItemMarker): string | null {
  if (marker.source === "custom") {
    return marker.unclaimedIconUrl || null;
  }

  return marker.presetIndex === null ? null : getItemMarkerPresetUrls(marker.presetIndex).unclaimedUrl;
}

export function resolveLocationMarkerUrl(marker: EventLocationMarker): string | null {
  if (marker.source === "custom") {
    return marker.iconUrl || null;
  }

  return marker.presetIndex === null ? null : getLocationMarkerPresetUrl(marker.presetIndex);
}

// Port of huntry_get_event_location_marker_anchor(): preset 1 is a teardrop
// pin whose tip marks the position; every other icon is centered.
export function locationMarkerAnchor(marker: EventLocationMarker): "bottom" | "center" {
  return marker.source === "preset" && marker.presetIndex === 1 ? "bottom" : "center";
}
