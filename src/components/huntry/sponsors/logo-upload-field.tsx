"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Small } from "@bigcommerce/big-design";
import { CloudUploadIcon } from "@bigcommerce/big-design-icons";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { ImageKind, MAX_IMAGE_BYTES } from "@/lib/huntry/storage/image-validation";

const BOX_SIZE = "96px";

const PREVIEW_ONLY_CAPTION = "Preview only — image uploads aren't configured for this environment.";
const UPLOAD_CAPTION = "JPEG, PNG or WebP, up to 5 MB.";

// A tap-to-upload box, the interaction huntry/EVMS's own image pickers use
// (add_event_dialog.dart / add_company_dialog.dart — tap a bordered box,
// pick a file, the preview swaps in) rather than a plain URL text input.
//
// With `kind` + `onUploaded`, a picked file is POSTed to
// /api/internal/huntry/upload-image (BC-HUN-044) and the returned Firebase
// Storage URL is handed to the parent form, which submits it with the rest of
// the fields; the Server Action re-validates it. Without them the field stays
// a local preview only. The optional props let the Featured tab and the event
// banner reuse it; every default reproduces the sponsor logo field.
export function LogoUploadField({
  previewUrl,
  label = "Logo",
  ariaLabel = "Change sponsor logo",
  altText = "Sponsor logo preview",
  width = BOX_SIZE,
  caption,
  kind,
  onUploaded,
}: {
  previewUrl: string;
  label?: string;
  ariaLabel?: string;
  altText?: string;
  width?: string;
  caption?: string;
  kind?: ImageKind;
  onUploaded?: (url: string) => void;
}) {
  const storeHash = useStoreHash();
  const inputRef = useRef<HTMLInputElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUpload = Boolean(kind && onUploaded && storeHash);

  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectUrl]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];

    // Lets the same file be picked again after a failed upload.
    input.value = "";

    if (!file) {
      return;
    }

    setError(null);

    if (canUpload && file.size > MAX_IMAGE_BYTES) {
      setError("Images must be 5 MB or smaller.");

      return;
    }

    if (!canUpload) {
      setObjectUrl(URL.createObjectURL(file));

      return;
    }

    setIsUploading(true);

    try {
      const body = new FormData();
      body.set("kind", kind as string);
      body.set("file", file);

      const response = await fetch(`/api/internal/huntry/upload-image?storeHash=${encodeURIComponent(storeHash as string)}`, {
        method: "POST",
        body,
      });
      const result = (await response.json().catch(() => ({}))) as { url?: string; error?: string };

      if (!response.ok || !result.url) {
        setError(result.error ?? "Failed to upload the image.");

        return;
      }

      setObjectUrl(URL.createObjectURL(file));
      onUploaded?.(result.url);
    } catch {
      setError("Failed to upload the image.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Box marginBottom="medium">
      <Small marginBottom="xSmall">{label}</Small>

      <button
        aria-label={ariaLabel}
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        style={{
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: "12px",
          cursor: "pointer",
          height: BOX_SIZE,
          overflow: "hidden",
          padding: 0,
          position: "relative",
          width,
        }}
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- local preview (object URL) or a public/ static asset, neither benefits from next/image */}
        <img
          alt={altText}
          height={BOX_SIZE}
          src={objectUrl ?? previewUrl}
          style={{ objectFit: "cover" }}
          width={width}
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

      <Small marginTop="xSmall" style={{ color: error ? "#C0392B" : HUNTRY_COLORS.textMuted, maxWidth: "280px" }}>
        {error ?? (isUploading ? "Uploading…" : (caption ?? (canUpload ? UPLOAD_CAPTION : PREVIEW_ONLY_CAPTION)))}
      </Small>
    </Box>
  );
}
