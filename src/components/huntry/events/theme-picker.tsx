"use client";

import { Box, Flex, Small } from "@bigcommerce/big-design";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EVENT_THEME_PRESETS, EventThemeColors } from "@/lib/huntry/events/types";

const SWATCH_SIZE = "48px";

// Ported from huntry/includes/events/index.php's "Theme colour" section
// (huntry_get_event_theme_presets(), huntry_render_event_details_meta_box())
// — 6 primary/success color-pair presets plus "Custom" — see
// docs/HUNTRY-UI-REFERENCE.md. Unlike the plugin, the selected preset index
// is passed in/out explicitly (EventThemeColors.preset) rather than
// re-derived by string-matching colors against the presets on load.
function Swatch({
  primaryColor,
  successColor,
  isSelected,
  onClick,
  label,
}: {
  primaryColor: string;
  successColor: string;
  isSelected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={isSelected}
      onClick={onClick}
      style={{
        background: `linear-gradient(135deg, ${primaryColor} 50%, ${successColor} 50%)`,
        border: isSelected ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
        borderRadius: "12px",
        cursor: "pointer",
        height: SWATCH_SIZE,
        padding: 0,
        width: SWATCH_SIZE,
      }}
      type="button"
    />
  );
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: EventThemeColors;
  onChange: (colors: EventThemeColors) => void;
}) {
  const isCustom = value.preset === null;

  return (
    <Box marginBottom="medium">
      <Small marginBottom="xSmall">Theme colour</Small>
      <Flex flexGap="0.5rem" flexWrap="wrap">
        {EVENT_THEME_PRESETS.map((preset, index) => (
          <Swatch
            key={index}
            primaryColor={preset.primaryColor}
            successColor={preset.successColor}
            isSelected={value.preset === index}
            label={`Theme preset ${index + 1}`}
            onClick={() => onChange(preset)}
          />
        ))}
        <button
          aria-label="Custom theme"
          aria-pressed={isCustom}
          onClick={() => onChange({ ...value, preset: null })}
          style={{
            alignItems: "center",
            background: HUNTRY_COLORS.background,
            border: isCustom ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
            borderRadius: "12px",
            cursor: "pointer",
            display: "flex",
            fontSize: "11px",
            height: SWATCH_SIZE,
            justifyContent: "center",
            padding: 0,
            width: SWATCH_SIZE,
          }}
          type="button"
        >
          Custom
        </button>
      </Flex>

      {isCustom && (
        <Flex flexGap="1rem" marginTop="small">
          <Box>
            <Small marginBottom="xSmall">Primary color</Small>
            <input
              onChange={(event) => onChange({ ...value, primaryColor: event.target.value })}
              type="color"
              value={value.primaryColor}
            />
          </Box>
          <Box>
            <Small marginBottom="xSmall">Success color</Small>
            <input
              onChange={(event) => onChange({ ...value, successColor: event.target.value })}
              type="color"
              value={value.successColor}
            />
          </Box>
        </Flex>
      )}
    </Box>
  );
}
