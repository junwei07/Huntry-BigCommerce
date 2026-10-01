"use client";

import { Box, Flex, Input, Small } from "@bigcommerce/big-design";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventLocationMarker, getLocationMarkerPresetUrl, LOCATION_MARKER_PRESET_COUNT } from "@/lib/huntry/events/types";

const THUMB_SIZE = "48px";

// Ported from huntry/includes/events/index.php's "Player location marker"
// section — 4 presets or a custom icon URL. Same no-real-upload reasoning
// as ItemMarkerPicker — see docs/HUNTRY-UI-REFERENCE.md.
export function LocationMarkerPicker({
  value,
  onChange,
}: {
  value: EventLocationMarker;
  onChange: (marker: EventLocationMarker) => void;
}) {
  const isCustom = value.source === "custom";

  return (
    <Box marginBottom="medium">
      <Small marginBottom="xSmall">Player location marker</Small>
      <Flex flexGap="0.5rem" flexWrap="wrap">
        {Array.from({ length: LOCATION_MARKER_PRESET_COUNT }, (_, i) => i + 1).map((presetIndex) => {
          const isSelected = value.source === "preset" && value.presetIndex === presetIndex;

          return (
            <button
              aria-label={`Location marker ${presetIndex}`}
              aria-pressed={isSelected}
              key={presetIndex}
              onClick={() => onChange({ source: "preset", presetIndex, iconUrl: null })}
              style={{
                alignItems: "center",
                border: isSelected ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                height: "56px",
                justifyContent: "center",
                padding: "4px",
                width: "56px",
              }}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static preset asset under public/ */}
              <img alt={`Location marker ${presetIndex}`} height={THUMB_SIZE} src={getLocationMarkerPresetUrl(presetIndex)} width={THUMB_SIZE} />
            </button>
          );
        })}

        <button
          aria-label="Custom location marker"
          aria-pressed={isCustom}
          onClick={() => onChange({ source: "custom", presetIndex: null, iconUrl: value.iconUrl ?? "" })}
          style={{
            alignItems: "center",
            background: HUNTRY_COLORS.background,
            border: isCustom ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
            borderRadius: "8px",
            cursor: "pointer",
            display: "flex",
            fontSize: "11px",
            height: "56px",
            justifyContent: "center",
            padding: 0,
            width: "56px",
          }}
          type="button"
        >
          Custom
        </button>
      </Flex>

      {isCustom && (
        <Box marginTop="small">
          <Input
            label="Icon URL"
            onChange={(event) => onChange({ ...value, iconUrl: event.target.value })}
            value={value.iconUrl ?? ""}
          />
        </Box>
      )}
    </Box>
  );
}
