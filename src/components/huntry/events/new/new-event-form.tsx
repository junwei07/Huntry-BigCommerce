"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { createHuntryEvent } from "@/app/store/[storeHash]/huntry/events/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { Breadcrumb } from "@/components/huntry/breadcrumb";
import { EventFormFields } from "@/components/huntry/events/event-form-fields";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { DEFAULT_EVENT_THEME_COLORS, DEFAULT_ITEM_MARKER, DEFAULT_LOCATION_MARKER } from "@/lib/huntry/events/types";
import { getAppUrl } from "@/lib/routing/app-url";

const INITIAL_STATE: EventFormInput = {
  name: "",
  startsAt: "",
  endsAt: "",
  description: "",
  markerRadiusMeters: "25",
  maxGrabCount: "1",
  eggClaimCapacity: "1",
  itemMarker: DEFAULT_ITEM_MARKER,
  locationMarker: DEFAULT_LOCATION_MARKER,
  themeColors: DEFAULT_EVENT_THEME_COLORS,
};

// This is NewEventButton's destination for a useGlobalTransition({
// autoResolve: false }) navigation — see its comment. useClearGlobalLoading
// marks the full-page overlay done once this real form is actually showing,
// rather than when /huntry/events/new's own first-reveal Suspense fallback
// (ContentFallback) briefly appears ahead of it.
export function NewEventForm() {
  useClearGlobalLoading();

  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<EventFormInput>(INITIAL_STATE);

  const handleChange = (patch: Partial<EventFormInput>) => setState((current) => ({ ...current, ...patch }));

  // startsAt/endsAt/description are required in the WP source form
  // (`required` HTML attribute) — see docs/HUNTRY-UI-REFERENCE.md.
  const canSubmit = state.name.trim() !== "" && state.startsAt !== "" && state.endsAt !== "" && state.description.trim() !== "";

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => createHuntryEvent(state, storeHash));

      if (result.success) {
        router.push(getAppUrl(storeHash, "/huntry/events"));
      }
    });
  };

  return (
    <>
      <Breadcrumb
        crumbs={[{ label: "Events", href: getAppUrl(storeHash, "/huntry/events") }, { label: "Add New Event" }]}
      />
      <Panel header="Create Event" style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
        <EventFormFields onChange={handleChange} state={state} />

        <Flex flexGap="0.5rem" justifyContent="flex-end">
          <Button onClick={() => router.push(getAppUrl(storeHash, "/huntry/events"))} variant="subtle">
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            isLoading={isPending}
            onClick={handleSubmit}
            style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
            variant="primary"
          >
            Create Event
          </Button>
        </Flex>
      </Panel>
    </>
  );
}
