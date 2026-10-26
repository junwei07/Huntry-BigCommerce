"use client";

import { Box, Flex, FlexItem, Input, Small } from "@bigcommerce/big-design";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventItemMarker, getItemMarkerPresetUrls, ITEM_MARKER_PRESET_COUNT } from "@/lib/huntry/events/types";

const THUMB_SIZE = "40px";

// Ported from huntry/includes/events/index.php's "Item markers" section —
// one preset picks BOTH the unclaimed and claimed icon together (18 linked
// pairs), or a custom pair of URLs. No real file upload exists in this
// picker (the bucket uploads cover banners and logos only — docs/MIGRATION.md §8), so "custom" is two
// URL inputs rather than an upload widget. See docs/HUNTRY-UI-REFERENCE.md.
export function ItemMarkerPicker({
  value,
  onChange,
}: {
  value: EventItemMarker;
  onChange: (marker: EventItemMarker) => void;
}) {
  const isCustom = value.source === "custom";

  return (
    <Box marginBottom="medium">
      <Small marginBottom="none">Item markers</Small>
      <Small marginBottom="xSmall" style={{ color: HUNTRY_COLORS.textMuted }}>
        Pick a pair from the library — one choice sets both the unclaimed and claimed look together — or provide
        your own icon URLs.
      </Small>

      <Flex flexGap="0.5rem" flexWrap="wrap">
        {Array.from({ length: ITEM_MARKER_PRESET_COUNT }, (_, i) => i + 1).map((presetIndex) => {
          const { unclaimedUrl, claimedUrl } = getItemMarkerPresetUrls(presetIndex);
          const isSelected = value.source === "preset" && value.presetIndex === presetIndex;

          return (
            <button
              aria-label={`Item marker pair ${presetIndex}`}
              aria-pressed={isSelected}
              key={presetIndex}
              onClick={() =>
                onChange({ source: "preset", presetIndex, unclaimedIconUrl: null, claimedIconUrl: null })
              }
              style={{
                border: isSelected ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                gap: "2px",
                padding: "4px",
              }}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static preset assets under public/, next/image is unnecessary weight for a small picker thumbnail */}
              <img alt="Unclaimed" height={THUMB_SIZE} src={unclaimedUrl} width={THUMB_SIZE} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Claimed" height={THUMB_SIZE} src={claimedUrl} width={THUMB_SIZE} />
            </button>
          );
        })}

        <button
          aria-label="Custom item markers"
          aria-pressed={isCustom}
          onClick={() =>
            onChange({
              source: "custom",
              presetIndex: null,
              unclaimedIconUrl: value.unclaimedIconUrl ?? "",
              claimedIconUrl: value.claimedIconUrl ?? "",
            })
          }
          style={{
            alignItems: "center",
            background: HUNTRY_COLORS.background,
            border: isCustom ? `3px solid ${HUNTRY_COLORS.primary}` : "1px solid rgba(0,0,0,0.15)",
            borderRadius: "8px",
            cursor: "pointer",
            display: "flex",
            fontSize: "11px",
            height: "48px",
            justifyContent: "center",
            padding: 0,
            width: "90px",
          }}
          type="button"
        >
          Custom
        </button>
      </Flex>

      {isCustom && (
        <Flex flexGap="1rem" marginTop="small">
          <FlexItem flexGrow={1}>
            <Input
              label="Unclaimed icon URL"
              onChange={(event) => onChange({ ...value, unclaimedIconUrl: event.target.value })}
              value={value.unclaimedIconUrl ?? ""}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              label="Claimed icon URL"
              onChange={(event) => onChange({ ...value, claimedIconUrl: event.target.value })}
              value={value.claimedIconUrl ?? ""}
            />
          </FlexItem>
        </Flex>
      )}
    </Box>
  );
}
