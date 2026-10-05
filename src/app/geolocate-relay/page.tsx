import { GeolocateRelayView } from "@/components/huntry/map/geolocate-relay-view";

// Top-level route (sibling to (root) and [storeHash]), same reasoning as
// unauthorized/page.tsx: opened via window.open() as its own top-level
// browsing context, not nested in BigCommerce's control-panel iframe, so it
// needs no site frame and no session — see geolocate-relay-view.tsx.
export default function GeolocateRelayPage() {
  return <GeolocateRelayView />;
}
