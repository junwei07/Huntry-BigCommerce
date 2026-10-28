import { isFarEnough } from "@/lib/huntry/eggs/geo";
import { MAX_EGGS_PER_EVENT } from "@/lib/huntry/eggs/limits";

type Point = { lat: number; lng: number };

// Which dialog a click on the map opens while placing, or null for "ignore the
// click". The event cap and the minimum spacing are enforced up front (the
// server re-checks both).
export type MapClickOutcome = { kind: "limit" } | { kind: "proximity" } | { kind: "place"; lat: number; lng: number };

export function resolveMapClick(params: {
  isPlacing: boolean;
  isEditingLocation: boolean;
  hasDialog: boolean;
  // The click landed on an egg marker or popup. The DOM hit-test stays in the
  // component, since it needs `Element`.
  clickedOnOverlay: boolean;
  point: Point;
  eggs: Point[];
  pending: Point[];
  markerRadiusMeters: number;
}): MapClickOutcome | null {
  if (!params.isPlacing || params.isEditingLocation || params.hasDialog || params.clickedOnOverlay) {
    return null;
  }

  if (params.eggs.length + params.pending.length >= MAX_EGGS_PER_EVENT) {
    return { kind: "limit" };
  }

  if (!isFarEnough(params.point, [...params.eggs, ...params.pending], params.markerRadiusMeters)) {
    return { kind: "proximity" };
  }

  return { kind: "place", ...params.point };
}
