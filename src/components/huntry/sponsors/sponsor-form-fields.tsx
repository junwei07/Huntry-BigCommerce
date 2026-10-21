"use client";

import { Box, Input } from "@bigcommerce/big-design";
import { LogoUploadField } from "@/components/huntry/sponsors/logo-upload-field";
import { SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";

// Shared by new-sponsor-form.tsx (create) and edit-sponsor-form.tsx (edit) —
// field order/requiredness matches huntry/includes/sponsors/index.php's
// sponsor meta box exactly (see docs/HUNTRY-UI-REFERENCE.md): only Name
// (the post title) is required, every other field is a plain optional
// input — Instagram/Facebook/Website as URLs, Location as free text (not
// lat/lng, not a map link). Logo leads (image first, matching EVMS's
// company-dialog layout); its uploaded URL rides in `state.logoUrl`.
//
// Takes one state object + one patch-merging onChange, mirroring
// EventFormFields, rather than ~6 individual value/onChange props.
export function SponsorFormFields({
  state,
  onChange,
  logoPreviewUrl,
}: {
  state: SponsorFormInput;
  onChange: (patch: Partial<SponsorFormInput>) => void;
  logoPreviewUrl: string;
}) {
  return (
    <>
      <LogoUploadField kind="sponsor-logo" onUploaded={(url) => onChange({ logoUrl: url })} previewUrl={logoPreviewUrl} />

      <Box marginBottom="medium">
        <Input label="Name" onChange={(event) => onChange({ name: event.target.value })} required value={state.name} />
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Instagram URL"
          onChange={(event) => onChange({ instagramUrl: event.target.value })}
          type="url"
          value={state.instagramUrl}
        />
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Facebook URL"
          onChange={(event) => onChange({ facebookUrl: event.target.value })}
          type="url"
          value={state.facebookUrl}
        />
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Website URL"
          onChange={(event) => onChange({ websiteUrl: event.target.value })}
          type="url"
          value={state.websiteUrl}
        />
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Location"
          onChange={(event) => onChange({ location: event.target.value })}
          value={state.location}
        />
      </Box>
    </>
  );
}
