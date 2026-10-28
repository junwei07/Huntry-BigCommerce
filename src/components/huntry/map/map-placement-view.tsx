"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/huntry/map/egg-marker.css";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as maplibregl from "maplibre-gl";
import { Box, Flex, Text } from "@bigcommerce/big-design";
import { FormSelect } from "@/components/ui/form-select";
import {
  deleteHuntryEgg,
  forceClaimHuntryEgg,
  saveHuntryEggPlacements,
  updateHuntryEgg,
} from "@/app/store/[storeHash]/huntry/map/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { buildMapSearchParams } from "@/lib/huntry/map/query";
import { fitMapToEggs } from "@/components/huntry/map/map-shared";
import { HuntryGeolocateControl } from "@/components/huntry/map/geolocate-control";
import { EggItemsPanel } from "@/components/huntry/map/egg-items-panel";
import { EditLocationBar, MapDialogs, PlacingToolbar, RewardLegend } from "@/components/huntry/map/map-overlays";
import { Dialog, EditLocation } from "@/components/huntry/map/map-types";
import { useEditLocationDrag } from "@/components/huntry/map/use-edit-location-drag";
import { useEggMarkers } from "@/components/huntry/map/use-egg-markers";
import { useMapGeolocation } from "@/components/huntry/map/use-map-geolocation";
import { useMapInstance } from "@/components/huntry/map/use-map-instance";
import { useRadiusOverlay } from "@/components/huntry/map/use-radius-overlay";
import type { EggClaimCount } from "@/lib/huntry/claims/types";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { resolveMapClick } from "@/lib/huntry/map/placement-click";
import { locationMarkerAnchor, resolveItemMarkerUrl, resolveLocationMarkerUrl } from "@/lib/huntry/events/marker-urls";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

export function MapPlacementView({
  events,
  selectedEventId,
  eggs,
  rewards,
  rewardEggCounts,
  claimCounts,
  sponsorNames,
}: {
  events: HuntryEvent[];
  selectedEventId: number | null;
  eggs: HuntryEgg[];
  rewards: HuntryReward[];
  // reward id -> eggs it has across every event (what egg_capacity bounds).
  rewardEggCounts: Record<number, number>;
  // egg id -> claims on it (forced included); eggs with no claims are absent.
  claimCounts: Record<string, EggClaimCount>;
  sponsorNames: Record<number, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useGlobalTransition();
  // Plain transition for the egg mutations' own button spinners — the global
  // overlay is reserved for navigation (event switch).
  const [isSaving, startSaving] = useTransition();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Full-screen placement mode (huntry-admin-map.js's .is-fullscreen). New
  // placements queue in `pending` and are committed in one Server Action
  // when the admin clicks Stop Placing; edit/delete commit immediately.
  const [isPlacing, setIsPlacing] = useState(false);
  const [pending, setPending] = useState<PendingEgg[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editLocation, setEditLocation] = useState<EditLocation | null>(null);
  // The map's click listener is registered once (in the map-creation effect);
  // it calls through this ref so it always sees the latest state.
  const mapClickRef = useRef<(event: maplibregl.MapMouseEvent) => void>(() => undefined);
  const isFullscreen = isPlacing || editLocation !== null;
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const markerRadiusMeters = selectedEvent?.markerRadiusMeters ?? 20;
  const claimCapacity = selectedEvent?.eggClaimCapacity ?? 1;
  const itemMarkerUrl = selectedEvent ? resolveItemMarkerUrl(selectedEvent.theme.itemMarker) : null;
  const locationMarkerUrl = selectedEvent ? resolveLocationMarkerUrl(selectedEvent.theme.locationMarker) : null;
  const locationAnchor = selectedEvent ? locationMarkerAnchor(selectedEvent.theme.locationMarker) : "center";

  const geolocateControlRef = useRef<HuntryGeolocateControl | null>(null);
  const { triggerLocate } = useMapGeolocation({ mapRef, geolocateControlRef, locationMarkerUrl, locationAnchor });

  useMapInstance({ mapContainerRef, mapRef, geolocateControlRef, mapClickRef, triggerLocate, isFullscreen });

  const { eggMarkersRef, highlight, flyToEgg } = useEggMarkers({
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
    isEditingLocation: editLocation !== null,
  });

  const openEdit = useCallback((egg: HuntryEgg) => setDialog({ kind: "edit", egg }), []);
  const openDelete = useCallback((egg: HuntryEgg) => setDialog({ kind: "delete", egg }), []);
  const openForceClaim = useCallback((egg: HuntryEgg) => setDialog({ kind: "forceClaim", egg }), []);

  // Fit the map to the selected event's eggs once per event (not on every
  // refresh after an edit/delete, which would yank the view around).
  const fittedEventRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || fittedEventRef.current === selectedEventId) {
      return;
    }

    fittedEventRef.current = selectedEventId;

    fitMapToEggs(map, eggs);
  }, [eggs, selectedEventId]);

  // "Edit Location" (plugin's enterEditLocationMode): the egg's *own* marker
  // becomes draggable with a glow, and a static grey ghost marks where it
  // started. One marker rather than a second stacked copy, so nothing can
  // sit on top of the draggable element and swallow the mousedown.
  const editingEgg = editLocation?.egg ?? null;

  useEditLocationDrag({
    mapRef,
    eggMarkersRef,
    eggs,
    pending,
    editingEgg,
    markerRadiusMeters,
    itemMarkerUrl,
    setEditLocation,
  });

  // Keep-out circles around every egg while placing/relocating, so the admin
  // can see where a new egg won't fit. Drawn at half the marker radius (as in
  // huntry-admin-map.js): eggs must be a full radius apart, so valid
  // neighbors' circles touch instead of overlapping.
  const editLat = editLocation?.lat;
  const editLng = editLocation?.lng;

  useRadiusOverlay({ mapRef, eggs, pending, isFullscreen, editingEgg, editLat, editLng, markerRadiusMeters });

  // Clicking the map while placing: enforce the event cap and the minimum
  // spacing up front (the server re-checks both), else open the Place dialog.
  // Re-assigned every render so the listener registered once above never
  // sees stale state.
  useEffect(() => {
    mapClickRef.current = (event) => {
      const target = event.originalEvent.target;
      const outcome = resolveMapClick({
        isPlacing,
        isEditingLocation: editLocation !== null,
        hasDialog: dialog !== null,
        clickedOnOverlay: target instanceof Element && target.closest(".maplibregl-marker, .maplibregl-popup") !== null,
        point: { lat: event.lngLat.lat, lng: event.lngLat.lng },
        eggs,
        pending,
        markerRadiusMeters,
      });

      if (outcome) {
        setDialog(outcome);
      }
    };
  });

  // Browser-level guard (tab close / reload) for queued, unsaved placements.
  // In-app navigation is guarded separately in selectEvent.
  useEffect(() => {
    if (pending.length === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pending.length]);

  // Cancel snaps the marker back to where it started; confirm leaves it at the
  // new spot until the revalidated eggs arrive (no flash back to the old one).
  const cancelEditLocation = () => {
    if (editLocation) {
      eggMarkersRef.current.get(editLocation.egg.id)?.setLngLat([editLocation.egg.lng, editLocation.egg.lat]);
    }

    setEditLocation(null);
  };

  const stopPlacing = () => {
    if (pending.length === 0 || selectedEventId === null) {
      setIsPlacing(false);
      return;
    }

    const adds = pending.map(({ rewardId, name, lat, lng }) => ({ rewardId, name, lat, lng }));

    startSaving(async () => {
      const result = await runServerAction(() => saveHuntryEggPlacements(selectedEventId, adds, storeHash));

      // On failure the queue is kept so nothing the admin placed is lost.
      if (result.success) {
        setPending([]);
        setIsPlacing(false);
      }
    });
  };

  const submitPlace = (value: { name: string; rewardId: number }) => {
    if (dialog?.kind !== "place") {
      return;
    }

    const { lat, lng } = dialog;

    setPending((current) => [...current, { key: crypto.randomUUID(), ...value, lat, lng }]);
    setDialog(null);
  };

  const submitEdit = (egg: HuntryEgg, value: { name: string; rewardId: number }) => {
    startSaving(async () => {
      const result = await runServerAction(() => updateHuntryEgg(egg.id, value, storeHash));

      if (result.success) {
        setDialog(null);
      }
    });
  };

  const beginEditLocation = (egg: HuntryEgg, value: { name: string; rewardId: number | null }) => {
    setDialog(null);
    setEditLocation({
      egg,
      name: value.name,
      rewardId: value.rewardId ?? egg.rewardId,
      lat: egg.lat,
      lng: egg.lng,
      valid: true,
    });
  };

  const confirmEditLocation = () => {
    if (!editLocation?.valid) {
      return;
    }

    const { egg, name, rewardId, lat, lng } = editLocation;

    startSaving(async () => {
      const result = await runServerAction(() => updateHuntryEgg(egg.id, { name, rewardId, lat, lng }, storeHash));

      if (result.success) {
        setEditLocation(null);
      }
    });
  };

  const confirmDelete = (egg: HuntryEgg) => {
    startSaving(async () => {
      await runServerAction(() => deleteHuntryEgg(egg.id, storeHash));
      setDialog(null);
    });
  };

  // Unlike the plugin's form-POST flow, this doesn't reload the page, so queued
  // (unsaved) placements survive a Force Claim. The dialog stays open on
  // failure so the admin can correct the email.
  const confirmForceClaim = (egg: HuntryEgg, email: string) => {
    startSaving(async () => {
      const result = await runServerAction(() => forceClaimHuntryEgg(egg.id, email, storeHash));

      if (result.success) {
        setDialog(null);
      }
    });
  };

  const eventOptions = events.map((event) => ({ value: String(event.id), content: event.name }));

  const selectEvent = (eventId: string | number | null) => {
    const parsedEventId = eventId === null ? null : Number(eventId);
    const params = buildMapSearchParams(parsedEventId);
    const queryString = params.toString();

    const navigate = () => {
      startTransition(() => {
        router.push(queryString ? `${pathname}?${queryString}` : pathname);
      });
    };

    // Switching events would silently drop the queued placements.
    if (pending.length > 0) {
      setDialog({
        kind: "unsaved",
        onLeave: () => {
          setPending([]);
          setIsPlacing(false);
          setDialog(null);
          navigate();
        },
      });
      return;
    }

    navigate();
  };

  const usedRewards = rewards.filter((reward) => eggs.some((egg) => egg.rewardId === reward.id));

  return (
    <Box>
      <Box marginBottom="medium" style={{ maxWidth: "20rem" }}>
        <FormSelect
          disabled={isPending}
          label="Event"
          onOptionChange={selectEvent}
          options={eventOptions}
          value={selectedEventId === null ? "" : String(selectedEventId)}
        />
      </Box>
      <Text style={{ color: HUNTRY_COLORS.textMuted, marginBottom: "small" }}>
        Click on the cross-hair to use precise location.
      </Text>

      <Flex flexDirection="row" alignItems="flex-start" style={{ gap: "1rem" }}>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: "600px", position: "relative", width: "100%" }}>
            {/* Same element in both modes (maplibre owns its canvas) — only the
                wrapper's positioning changes, mirroring huntry-admin-map.js's
                #huntry-map-fullscreen-wrapper.is-fullscreen. */}
            <div
              style={
                isFullscreen
                  ? { position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", backgroundColor: "#fff" }
                  : { height: "100%", width: "100%" }
              }
            >
              {isPlacing && !editLocation ? (
                <PlacingToolbar isSaving={isSaving} onStop={stopPlacing} pendingCount={pending.length} />
              ) : null}
              <div ref={mapContainerRef} style={{ flex: 1, height: "100%", width: "100%" }} />
              {editLocation ? (
                <EditLocationBar
                  editLocation={editLocation}
                  isSaving={isSaving}
                  markerRadiusMeters={markerRadiusMeters}
                  onCancel={cancelEditLocation}
                  onConfirm={confirmEditLocation}
                />
              ) : null}
            </div>
          </div>
          {usedRewards.length > 0 ? <RewardLegend rewards={usedRewards} /> : null}
        </Box>

        <EggItemsPanel
          claimCapacity={claimCapacity}
          claimCounts={claimCounts}
          eggs={eggs}
          highlight={highlight}
          onDeleteEgg={openDelete}
          onEditEgg={openEdit}
          onForceClaimEgg={openForceClaim}
          onPlaceItem={() => setIsPlacing(true)}
          onRemovePending={(key) => setPending((current) => current.filter((egg) => egg.key !== key))}
          onSelectEgg={flyToEgg}
          pending={pending}
          rewards={rewards}
        />
      </Flex>

      <MapDialogs
        claimCapacity={claimCapacity}
        claimCounts={claimCounts}
        dialog={dialog}
        isSaving={isSaving}
        markerRadiusMeters={markerRadiusMeters}
        onBeginEditLocation={beginEditLocation}
        onClose={() => setDialog(null)}
        onConfirmDelete={confirmDelete}
        onConfirmForceClaim={confirmForceClaim}
        onSubmitEdit={submitEdit}
        onSubmitPlace={submitPlace}
        pending={pending}
        rewardEggCounts={rewardEggCounts}
        rewards={rewards}
        sponsorNames={sponsorNames}
      />
    </Box>
  );
}
