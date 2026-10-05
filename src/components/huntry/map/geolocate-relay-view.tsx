"use client";

import { useEffect, useState } from "react";
import { Box, Text } from "@bigcommerce/big-design";
import { GEOLOCATE_RELAY_MESSAGE_SOURCE } from "@/lib/huntry/map/geolocate-relay";

// Opened via window.open() from MapPlacementView (not rendered inside the
// BigCommerce control panel's iframe) — a real top-level browsing context,
// so navigator.geolocation isn't blocked by the iframe's Permissions
// Policy the way it is in the embedded map. Carries no store/session data;
// its only job is relaying one coordinate pair back to window.opener.
export function GeolocateRelayView() {
  // Always the same on server and client — the feature check below only
  // ever runs client-side, inside the effect. (Checking navigator here in
  // a useState initializer caused a hydration mismatch: modern Node ships
  // a stub global `navigator` with no `.geolocation`, so `typeof navigator
  // !== "undefined"` is true during SSR too, and the server would render
  // the "not supported" branch even though the real browser has it.)
  const [statusText, setStatusText] = useState("Requesting your location…");

  useEffect(() => {
    if (!navigator.geolocation) {
      window.opener?.postMessage(
        { source: GEOLOCATE_RELAY_MESSAGE_SOURCE, status: "error", message: "Geolocation isn't supported." },
        window.location.origin,
      );
      // Deferred to a microtask, not called synchronously here, to satisfy
      // react-hooks/set-state-in-effect the same way the async
      // getCurrentPosition callbacks below already do.
      queueMicrotask(() => setStatusText("Geolocation isn't supported in this browser. You can close this window."));
      window.close();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.opener?.postMessage(
          {
            source: GEOLOCATE_RELAY_MESSAGE_SOURCE,
            status: "success",
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          window.location.origin,
        );
        setStatusText("Got it — you can close this window.");
        window.close();
      },
      (error) => {
        window.opener?.postMessage(
          { source: GEOLOCATE_RELAY_MESSAGE_SOURCE, status: "error", message: error.message },
          window.location.origin,
        );
        setStatusText("Couldn't get your location. You can close this window.");
        window.close();
      },
      { enableHighAccuracy: true },
    );
  }, []);

  return (
    <Box padding="large">
      <Text>{statusText}</Text>
    </Box>
  );
}
