"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/huntry/map/egg-marker.css";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  buildEggInfoContent,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  eggMarkerOptions,
  fitMapToEggs,
  MAP_STYLE_URL,
  MAP_WORKER_URL,
} from "@/components/huntry/map/map-shared";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

export interface OverviewMapEgg {
  id: string;
  rewardId: number;
  name: string;
  lat: number;
  lng: number;
}

// Read-only counterpart of the Map tab (huntry/assets/js/huntry-overview-map.js):
// just plots the selected event's placed eggs. Editing stays on the Map tab.
// Mount with key={eventId} so switching events rebuilds the map.
export function OverviewMap({
  eggs,
  itemMarkerUrl,
  rewardNames,
  claimCounts,
  claimCapacity,
}: {
  eggs: OverviewMapEgg[];
  itemMarkerUrl: string | null;
  rewardNames: Record<number, string>;
  claimCounts: Record<string, number>;
  claimCapacity: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);

  // Popup text is read through a ref so claim/name changes never rebuild markers.
  const popupDataRef = useRef({ rewardNames, claimCounts, claimCapacity });

  useEffect(() => {
    popupDataRef.current = { rewardNames, claimCounts, claimCapacity };
  }, [rewardNames, claimCounts, claimCapacity]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let map: maplibregl.Map;

    try {
      maplibregl.setWorkerUrl(MAP_WORKER_URL);
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
      });
    } catch {
      // No WebGL (restricted iframe, headless browser) — degrade, don't crash the page.
      queueMicrotask(() => setFailed(true));
      return;
    }

    map.addControl(new maplibregl.NavigationControl());
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    let popup: maplibregl.Popup | null = null;
    const markers: maplibregl.Marker[] = [];
    const closePopup = () => {
      popup?.remove();
      popup = null;
    };

    for (const egg of eggs) {
      const marker = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, egg.rewardId))
        .setLngLat([egg.lng, egg.lat])
        .addTo(map);
      const element = marker.getElement();

      element.style.cursor = "pointer";
      element.addEventListener("mouseenter", () => {
        const data = popupDataRef.current;
        const rewardName = data.rewardNames[egg.rewardId];

        closePopup();
        popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
          .setLngLat([egg.lng, egg.lat])
          .setDOMContent(
            buildEggInfoContent(egg.name || rewardName || "Unnamed egg", [
              `Reward: ${rewardName ?? "Unknown reward"}`,
              `Claims: ${data.claimCounts[egg.id] ?? 0}/${data.claimCapacity}`,
            ]),
          )
          .addTo(map);
      });
      element.addEventListener("mouseleave", closePopup);
      markers.push(marker);
    }

    fitMapToEggs(map, eggs);

    return () => {
      closePopup();

      for (const marker of markers) {
        marker.remove();
      }
    };
  }, [eggs, itemMarkerUrl, failed]);

  if (failed) {
    return <p style={{ color: HUNTRY_COLORS.textMuted, fontSize: 13 }}>Map unavailable in this browser.</p>;
  }

  return <div ref={containerRef} style={{ height: 400, borderRadius: 8, overflow: "hidden" }} />;
}
