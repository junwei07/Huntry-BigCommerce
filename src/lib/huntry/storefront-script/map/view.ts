import { StorefrontEvent } from "../types";

export interface MapView {
  center: [number, number]; // [lng, lat], maplibre order
  zoom: number;
}

// The map shows one event per page: the ?event= slug if it matches, otherwise
// the first live event map-data returned.
export function pickEvent(events: StorefrontEvent[], slug?: string): StorefrontEvent | null {
  return (slug ? events.find((event) => event.slug === slug) : undefined) ?? events[0] ?? null;
}

// Centred on the eggs' centroid at street zoom (legacy huntry-frontend-map.js
// L255-262: zoom 14 with eggs). With no eggs there is nothing to centre on, so
// show the whole world rather than an arbitrary spot.
export function initialView(event: StorefrontEvent): MapView {
  if (event.eggs.length === 0) {
    return { center: [0, 20], zoom: 2 };
  }

  const lat = event.eggs.reduce((sum, egg) => sum + egg.lat, 0) / event.eggs.length;
  const lng = event.eggs.reduce((sum, egg) => sum + egg.lng, 0) / event.eggs.length;

  return { center: [lng, lat], zoom: 14 };
}
