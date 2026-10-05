"use client";

import { Box, Flex, FlexItem, Input, Textarea } from "@bigcommerce/big-design";
import { ItemMarkerPicker } from "@/components/huntry/events/item-marker-picker";
import { LocationMarkerPicker } from "@/components/huntry/events/location-marker-picker";
import { ThemePicker } from "@/components/huntry/events/theme-picker";
import { EventFormInput } from "@/lib/huntry/events/event-form-schema";

// Shared by new-event-form.tsx (create) and edit-event-form.tsx (edit) —
// extracted so the ~150 lines of field JSX aren't duplicated near-verbatim
// between the two. Field order matches huntry/includes/events/index.php's
// huntry_render_event_details_meta_box() exactly (see
// docs/HUNTRY-UI-REFERENCE.md) — no slug field either way (the plugin has
// none; slug is derived/preserved server-side, never user-typed).
//
// Takes one state object + one patch-merging onChange, rather than ~20
// individual value/onChange props — each caller owns its own useState and
// submit handler (create vs. update are genuinely different flows), but
// renders identically otherwise.
export function EventFormFields({
  state,
  onChange,
}: {
  state: EventFormInput;
  onChange: (patch: Partial<EventFormInput>) => void;
}) {
  return (
    <>
      <Box marginBottom="medium">
        <Input label="Name" onChange={(event) => onChange({ name: event.target.value })} required value={state.name} />
      </Box>

      <Box marginBottom="medium">
        <Flex flexGap="1rem">
          <FlexItem flexGrow={1}>
            <Input
              label="Starts at"
              onChange={(event) => onChange({ startsAt: event.target.value })}
              required
              type="datetime-local"
              value={state.startsAt}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              label="Ends at"
              onChange={(event) => onChange({ endsAt: event.target.value })}
              required
              type="datetime-local"
              value={state.endsAt}
            />
          </FlexItem>
        </Flex>
      </Box>

      <Box marginBottom="medium">
        <Textarea
          label="Description"
          onChange={(event) => onChange({ description: event.target.value })}
          required
          rows={3}
          value={state.description}
        />
      </Box>

      <Box marginBottom="medium">
        <Flex flexGap="1rem">
          <FlexItem flexGrow={1}>
            <Input
              label="Marker radius (meters)"
              onChange={(event) => onChange({ markerRadiusMeters: event.target.value })}
              type="number"
              value={state.markerRadiusMeters}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              description="Maximum number of eggs a single player can claim during this event. Use 0 for unlimited."
              label="Max user grab count"
              onChange={(event) => onChange({ maxGrabCount: event.target.value })}
              type="number"
              value={state.maxGrabCount}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              description="How many different players can claim the same egg before it becomes fully claimed."
              label="Item claim count"
              onChange={(event) => onChange({ eggClaimCapacity: event.target.value })}
              type="number"
              value={state.eggClaimCapacity}
            />
          </FlexItem>
        </Flex>
      </Box>

      <ItemMarkerPicker onChange={(itemMarker) => onChange({ itemMarker })} value={state.itemMarker} />
      <LocationMarkerPicker onChange={(locationMarker) => onChange({ locationMarker })} value={state.locationMarker} />
      <ThemePicker onChange={(themeColors) => onChange({ themeColors })} value={state.themeColors} />
    </>
  );
}
