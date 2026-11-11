"use client";

import { Box, Flex, FlexItem, Small } from "@bigcommerce/big-design";
import { LogoUploadField } from "@/components/huntry/sponsors/logo-upload-field";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { EventItemMarker, getItemMarkerPresetUrls, ITEM_MARKER_PRESET_COUNT } from "@/lib/huntry/events/types";

const THUMB_SIZE = "40px";
const THUMB_BOX = "96px";
const ICON_CAPTION = "JPEG, PNG or WebP.";

// Ported from huntry/includes/events/index.php's "Item markers" section —
// one preset picks BOTH the unclaimed and claimed icon together (18 linked
// pairs), or a custom pair of uploaded images (Firebase Storage, validated
// server-side by resolveEventMarkers). See docs/HUNTRY-UI-REFERENCE.md.
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
        Pick a pair from the library — one choice sets both the unclaimed and claimed look together — or upload
        your own icons.
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
        <Flex flexGap="1.5rem" flexWrap="wrap" marginTop="small">
          <FlexItem style={{ width: "140px" }}>
            <LogoUploadField
              altText="Unclaimed marker preview"
              ariaLabel="Upload unclaimed marker icon"
              caption={ICON_CAPTION}
              height={THUMB_BOX}
              kind="event-item-marker"
              label="Unclaimed icon"
              onUploaded={(url) => onChange({ ...value, unclaimedIconUrl: url })}
              previewUrl={value.unclaimedIconUrl || getItemMarkerPresetUrls(1).unclaimedUrl}
              width={THUMB_BOX}
            />
          </FlexItem>
          <FlexItem style={{ width: "140px" }}>
            <LogoUploadField
              altText="Claimed marker preview"
              ariaLabel="Upload claimed marker icon"
              caption={ICON_CAPTION}
              height={THUMB_BOX}
              kind="event-item-marker"
              label="Claimed icon"
              onUploaded={(url) => onChange({ ...value, claimedIconUrl: url })}
              previewUrl={value.claimedIconUrl || getItemMarkerPresetUrls(1).claimedUrl}
              width={THUMB_BOX}
            />
          </FlexItem>
        </Flex>
      )}
    </Box>
  );
}
