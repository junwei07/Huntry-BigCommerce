"use client";

import { useState, useTransition } from "react";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { updateHuntryEvent } from "@/app/store/[storeHash]/huntry/events/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
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
  // This is EventActionsMenu's destination for a useGlobalTransition({
  // autoResolve: false }) navigation — see its comment. Marks the full-page
  // overlay done once this real form is actually showing, mirroring
  // NewEventForm's precedent.
  useClearGlobalLoading();

  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<EventFormInput>(() => toFormState(event));

  const handleChange = (patch: Partial<EventFormInput>) => setState((current) => ({ ...current, ...patch }));

  const canSubmit = state.name.trim() !== "" && state.startsAt !== "" && state.endsAt !== "" && state.description.trim() !== "";

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => updateHuntryEvent(event.id, state, storeHash));

      if (result.success) {
        // A hard, iframe-scoped navigation rather than router.push —
        // leaving this dynamic [id] route via a client-side transition can
        // get permanently stuck re-rendering this same edit form (no
        // error, only a hard refresh recovers; router.push + router.refresh
        // was tried first and didn't fix it either). window.location (not
        // window.top.location) only reloads
        // this app's own iframe content, never BigCommerce's own admin
        // frame around it.
        window.location.href = getAppUrl(storeHash, "/huntry/events");
      }
    });
  };

  return (
    <Panel header={`Edit Event: ${event.name}`} style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
      <EventFormFields bannerPreviewUrl={event.headerBannerUrl ?? undefined} onChange={handleChange} state={state} />

      <Flex flexGap="0.5rem" justifyContent="flex-end">
        <Button
          onClick={() => {
            // See handleSubmit's identical comment on why this is a hard
            // navigation rather than router.push.
            window.location.href = getAppUrl(storeHash, "/huntry/events");
          }}
          variant="subtle"
        >
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
