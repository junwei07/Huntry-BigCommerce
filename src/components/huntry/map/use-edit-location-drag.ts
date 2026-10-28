import { Dispatch, RefObject, SetStateAction, useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import { EditLocation } from "@/components/huntry/map/map-types";
import { eggMarkerOptions } from "@/components/huntry/map/map-shared";
import { isFarEnough } from "@/lib/huntry/eggs/geo";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";

// "Edit Location" mode's map behavior: the egg's own marker becomes draggable
// (see the effect's comment), then the camera flies to it. Must be called after
// useEggMarkers, whose marker effect populates eggMarkersRef.
export function useEditLocationDrag({
  mapRef,
  eggMarkersRef,
  eggs,
  pending,
  editingEgg,
  markerRadiusMeters,
  itemMarkerUrl,
  setEditLocation,
}: {
  mapRef: RefObject<maplibregl.Map | null>;
  eggMarkersRef: RefObject<Map<string, maplibregl.Marker>>;
  eggs: HuntryEgg[];
  pending: PendingEgg[];
  editingEgg: HuntryEgg | null;
  markerRadiusMeters: number;
  itemMarkerUrl: string | null;
  setEditLocation: Dispatch<SetStateAction<EditLocation | null>>;
}) {
  // "Edit Location" (plugin's enterEditLocationMode): the egg's *own* marker
  // becomes draggable with a glow, and a static grey ghost marks where it
  // started. One marker rather than a second stacked copy, so nothing can
  // sit on top of the draggable element and swallow the mousedown.
  useEffect(() => {
    const map = mapRef.current;
    const marker = editingEgg ? eggMarkersRef.current.get(editingEgg.id) : undefined;

    if (!map || !editingEgg || !marker) {
      return;
    }

    const others = [...eggs.filter((egg) => egg.id !== editingEgg.id), ...pending];
    // The grey ghost only appears once the admin starts dragging, left behind
    // at the original spot; until then there is just the one normal marker.
    let ghost: maplibregl.Marker | null = null;

    const handleDragStart = () => {
      if (ghost) {
        return;
      }

      ghost = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, editingEgg.rewardId))
        .setLngLat([editingEgg.lng, editingEgg.lat])
        .addTo(map);
      ghost.getElement().classList.add("huntry-admin-egg-marker--ghost");
      ghost.getElement().style.pointerEvents = "none";
      ghost.getElement().style.zIndex = "0";
    };

    const handleDrag = () => {
      const { lat, lng } = marker.getLngLat();

      setEditLocation((current) =>
        current ? { ...current, lat, lng, valid: isFarEnough({ lat, lng }, others, markerRadiusMeters) } : current,
      );
    };

    marker.setDraggable(true);
    marker.getElement().classList.add("huntry-admin-egg-marker--dragging-active");
    // Keeps the live marker above its own ghost.
    marker.getElement().style.zIndex = "1";
    marker.on("dragstart", handleDragStart);
    marker.on("drag", handleDrag);

    return () => {
      marker.off("dragstart", handleDragStart);
      marker.off("drag", handleDrag);
      marker.setDraggable(false);
      marker.getElement().classList.remove("huntry-admin-egg-marker--dragging-active");
      marker.getElement().style.zIndex = "";
      ghost?.remove();
    };
  }, [mapRef, eggMarkersRef, setEditLocation, editingEgg, eggs, pending, markerRadiusMeters, itemMarkerUrl]);

  // map.resize() has to run before flyTo() so the camera centres against the
  // full-screen size, not the old container — both in the same frame, after
  // the fullscreen wrapper has actually re-laid out.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !editingEgg) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      map.resize();
      map.flyTo({ center: [editingEgg.lng, editingEgg.lat], zoom: Math.max(map.getZoom(), 17), essential: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [mapRef, editingEgg]);
}
