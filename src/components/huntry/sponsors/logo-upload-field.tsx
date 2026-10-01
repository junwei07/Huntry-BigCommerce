"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Small } from "@bigcommerce/big-design";
import { CloudUploadIcon } from "@bigcommerce/big-design-icons";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const BOX_SIZE = "96px";

// A tap-to-upload box, the interaction huntry/EVMS's own image pickers use
// (add_event_dialog.dart / add_company_dialog.dart — tap a bordered box,
// pick a file, the preview swaps in) rather than a plain URL text input.
//
// Unlike ItemMarkerPicker/LocationMarkerPicker's "custom URL, labeled
// honestly, not a fake upload button" (docs/HUNTRY-UI-REFERENCE.md), this
// *is* a real file-picker interaction — the honesty is in the caption
// below: no object storage exists in this starter yet (BC-HUN-044), so a
// picked file only ever swaps the local preview via
// URL.createObjectURL — it's never sent anywhere, and the sponsor keeps
// DEFAULT_SPONSOR_LOGO_URL (or its existing logo, when editing) regardless
// of what's previewed here. No onChange prop: there's nothing downstream
// for a selection to flow into yet.
export function LogoUploadField({ previewUrl }: { previewUrl: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    setObjectUrl(URL.createObjectURL(file));
  };

  return (
    <Box marginBottom="medium">
      <Small marginBottom="xSmall">Logo</Small>

      <button
        aria-label="Change sponsor logo"
        onClick={() => inputRef.current?.click()}
        style={{
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: "12px",
          cursor: "pointer",
          height: BOX_SIZE,
          overflow: "hidden",
          padding: 0,
          position: "relative",
          width: BOX_SIZE,
        }}
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview (object URL) or a public/ static asset, neither benefits from next/image */}
        <img
          alt="Sponsor logo preview"
          height={BOX_SIZE}
          src={objectUrl ?? previewUrl}
          style={{ objectFit: "cover" }}
          width={BOX_SIZE}
        />

        <Box
          style={{
            alignItems: "center",
            background: HUNTRY_COLORS.primary,
            borderRadius: "9999px",
            bottom: "4px",
            display: "flex",
            height: "28px",
            justifyContent: "center",
            position: "absolute",
            right: "4px",
            width: "28px",
          }}
        >
          <CloudUploadIcon style={{ color: "#FFFFFF", height: "16px", width: "16px" }} />
        </Box>
      </button>

      <input accept="image/*" onChange={handleFileChange} ref={inputRef} style={{ display: "none" }} type="file" />

      <Small marginTop="xSmall" style={{ color: HUNTRY_COLORS.textMuted, maxWidth: "280px" }}>
        Preview only — image uploads aren&apos;t stored yet. New sponsors use the default logo until uploads are
        fully wired up.
      </Small>
    </Box>
  );
}
