import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { buildEggInfoContent, eggMarkerOptions } from "@/components/huntry/map/map-shared";
import type { EggClaimCount } from "@/lib/huntry/claims/types";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { buildEggInfoLines } from "@/lib/huntry/map/egg-info";
import { HuntryReward } from "@/lib/huntry/rewards/types";

// How long the marker pulse / panel row highlight lasts (plugin: 2400 ms).
const HIGHLIGHT_MS = 2400;

// Saved and queued egg markers, the hover info popup, the transient
// highlight of a clicked marker's panel row, and the fly-to-and-pulse
// behavior of a panel row's click. Must be called after useMapInstance so
// mapRef is set when the marker effects first run.
export function useEggMarkers({
  mapRef,
  eggs,
  pending,
  setPending,
  itemMarkerUrl,
  rewards,
  rewardEggCounts,
  sponsorNames,
  claimCapacity,
  claimCounts,
  isEditingLocation,
}: {
  mapRef: RefObject<maplibregl.Map | null>;
  eggs: HuntryEgg[];
  pending: PendingEgg[];
  setPending: Dispatch<SetStateAction<PendingEgg[]>>;
  itemMarkerUrl: string | null;
  rewards: HuntryReward[];
  rewardEggCounts: Record<number, number>;
  sponsorNames: Record<number, string>;
  claimCapacity: number;
  claimCounts: Record<string, EggClaimCount>;
  isEditingLocation: boolean;
}) {
  const eggMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const infoPopupRef = useRef<maplibregl.Popup | null>(null);
  const pulsedElementRef = useRef<HTMLElement | null>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marker click -> the egg's row in the panel scrolls into view and highlights.
  const [highlight, setHighlight] = useState<{ eggId: string; token: number } | null>(null);

  // Latest data for the hover popup, read at hover time through a ref so the
  // marker effect below only re-runs when the eggs themselves change (a
  // re-run would drop a marker that is mid-drag in Edit Location mode).
  const infoContextRef = useRef({
    rewards,
    rewardEggCounts,
    sponsorNames,
    pending,
    claimCapacity,
    claimCounts,
    isEditingLocation: false,
  });

  useEffect(() => {
    infoContextRef.current = {
      rewards,
      rewardEggCounts,
      sponsorNames,
      pending,
      claimCapacity,
      claimCounts,
      isEditingLocation,
    };
  });

  const closeInfoPopup = useCallback(() => {
    infoPopupRef.current?.remove();
    infoPopupRef.current = null;
  }, []);

  // Port of the plugin's openEggInfoPopup: reward, sponsor, eggs placed,
  // claims and coordinates. No close button — it
  // only ever opens/closes with the marker's mouseenter/mouseleave.
  const showEggInfo = useCallback(
    (egg: HuntryEgg) => {
      const map = mapRef.current;
      const context = infoContextRef.current;

      // Suppressed while repositioning — it would just clutter the drag view.
      if (!map || context.isEditingLocation) {
        return;
      }

      closeInfoPopup();

      const { title, lines } = buildEggInfoLines(egg, context);

      infoPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
        .setLngLat([egg.lng, egg.lat])
        .setDOMContent(buildEggInfoContent(title, lines))
        .addTo(map);
    },
    [mapRef, closeInfoPopup],
  );

  // One marker per saved egg, colored per reward (eggMarkerColor) so a reward
  // reads the same on the map, the items panel, and the legend. Hover shows
  // the info popup; click highlights the egg's row in the panel — the panel's
  // ⋯ menu is the only place to edit or delete. Declared after the
  // map-creation effect so mapRef is set by the time this first runs.
  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const markers = new Map<string, maplibregl.Marker>();

    for (const egg of eggs) {
      const marker = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, egg.rewardId))
        .setLngLat([egg.lng, egg.lat])
        .addTo(map);
      const element = marker.getElement();

      element.style.cursor = "pointer";
      element.addEventListener("mouseenter", () => showEggInfo(egg));
      element.addEventListener("mouseleave", closeInfoPopup);
      // stopPropagation: while placing, a click that bubbled to the map would
      // otherwise try to open "Place New Egg" at this same spot.
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setHighlight({ eggId: egg.id, token: Date.now() });
      });
      markers.set(egg.id, marker);
    }

    eggMarkersRef.current = markers;

    return () => {
      closeInfoPopup();

      for (const marker of markers.values()) {
        marker.remove();
      }

      eggMarkersRef.current = new Map();
    };
  }, [mapRef, eggs, itemMarkerUrl, showEggInfo, closeInfoPopup]);

  // Queued (unsaved) placements: same reward color, faded. Like the plugin,
  // clicking one removes it from the queue.
  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const markers = pending.map((egg) => {
      const marker = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, egg.rewardId))
        .setLngLat([egg.lng, egg.lat])
        .addTo(map);
      const element = marker.getElement();

      element.style.cursor = "pointer";
      element.style.opacity = "0.6";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setPending((current) => current.filter((item) => item.key !== egg.key));
      });

      return marker;
    });

    return () => {
      for (const marker of markers) {
        marker.remove();
      }
    };
  }, [mapRef, setPending, pending, itemMarkerUrl]);

  // The highlight is transient (plugin: 2.4 s) — the panel scrolls to the row
  // when it appears and drops the styling when it clears.
  useEffect(() => {
    if (!highlight) {
      return;
    }

    const timeout = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);

    return () => clearTimeout(timeout);
  }, [highlight]);

  // Port of the plugin's flyToAndHighlightMarker: flies to a panel row's egg
  // and pulses its marker briefly.
  const flyToEgg = (egg: HuntryEgg) => {
    const element = eggMarkersRef.current.get(egg.id)?.getElement();

    mapRef.current?.flyTo({ center: [egg.lng, egg.lat], zoom: 18, essential: true });

    if (!element) {
      return;
    }

    pulsedElementRef.current?.classList.remove("huntry-admin-egg-marker--highlight");

    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
    }

    element.classList.add("huntry-admin-egg-marker--highlight");
    pulsedElementRef.current = element;
    pulseTimeoutRef.current = setTimeout(() => {
      element.classList.remove("huntry-admin-egg-marker--highlight");
      pulsedElementRef.current = null;
    }, HIGHLIGHT_MS);
  };

  // Clears any in-flight pulse timer if the view unmounts.
  useEffect(
    () => () => {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
      }
    },
    [],
  );

  return { eggMarkersRef, highlight, flyToEgg };
}
