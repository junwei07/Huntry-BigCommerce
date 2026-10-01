"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { updateHuntryEvent } from "@/app/store/[storeHash]/huntry/events/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { EventFormFields } from "@/components/huntry/events/event-form-fields";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { toDatetimeLocalValue } from "@/lib/huntry/events/datetime-local";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { getAppUrl } from "@/lib/routing/app-url";

function toFormState(event: HuntryEvent): EventFormInput {
  return {
    name: event.name,
    startsAt: event.startsAt ? toDatetimeLocalValue(event.startsAt) : "",
    endsAt: event.endsAt ? toDatetimeLocalValue(event.endsAt) : "",
    description: event.description,
    markerRadiusMeters: String(event.markerRadiusMeters),
    maxGrabCount: String(event.maxGrabCount),
    eggClaimCapacity: String(event.eggClaimCapacity),
    itemMarker: event.theme.itemMarker,
    locationMarker: event.theme.locationMarker,
    themeColors: event.theme.colors,
  };
}

// headerBannerUrl/isFeatured/featuredOrder aren't edit-form fields (see
// event-form-fields.tsx) — the Server Action re-fetches the event fresh to
// preserve them rather than trusting anything from this form for those
// three. slug never changes here either — see docs/HUNTRY-UI-REFERENCE.md.
export function EditEventForm({ event }: { event: HuntryEvent }) {
  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<EventFormInput>(() => toFormState(event));

  const handleChange = (patch: Partial<EventFormInput>) => setState((current) => ({ ...current, ...patch }));

  const canSubmit = state.name.trim() !== "" && state.startsAt !== "" && state.endsAt !== "" && state.description.trim() !== "";

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => updateHuntryEvent(event.id, state, storeHash));

      if (result.success) {
        router.push(getAppUrl(storeHash, "/huntry/events"));
      }
    });
  };

  return (
    <Panel header={`Edit Event: ${event.name}`} style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
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
          Save Changes
        </Button>
      </Flex>
    </Panel>
  );
}
