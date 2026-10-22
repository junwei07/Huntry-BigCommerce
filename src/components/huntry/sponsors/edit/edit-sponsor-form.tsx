"use client";

import { useState, useTransition } from "react";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { updateHuntrySponsor } from "@/app/store/[storeHash]/huntry/sponsors/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { SponsorFormFields } from "@/components/huntry/sponsors/sponsor-form-fields";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { DEFAULT_SPONSOR_LOGO_URL, HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { getAppUrl } from "@/lib/routing/app-url";

function toFormState(sponsor: HuntrySponsor): SponsorFormInput {
  return {
    name: sponsor.name,
    instagramUrl: sponsor.instagramUrl ?? "",
    facebookUrl: sponsor.facebookUrl ?? "",
    websiteUrl: sponsor.websiteUrl ?? "",
    location: sponsor.location ?? "",
  };
}

export function EditSponsorForm({ sponsor }: { sponsor: HuntrySponsor }) {
  // This is SponsorActionsMenu's destination for a useGlobalTransition({
  // autoResolve: false }) navigation — see its comment. Marks the full-page
  // overlay done once this real form is actually showing, mirroring
  // NewSponsorForm's precedent.
  useClearGlobalLoading();

  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SponsorFormInput>(() => toFormState(sponsor));

  const handleChange = (patch: Partial<SponsorFormInput>) => setState((current) => ({ ...current, ...patch }));

  const canSubmit = state.name.trim() !== "";

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => updateHuntrySponsor(sponsor.id, state, storeHash));

      if (result.success) {
        // A hard, iframe-scoped navigation rather than router.push —
        // leaving this dynamic [id] route via a client-side transition can
        // get permanently stuck re-rendering this same edit form (no
        // error, only a hard refresh recovers; router.push + router.refresh
        // was tried first and didn't fix it either). window.location (not
        // window.top.location) only reloads
        // this app's own iframe content, never BigCommerce's own admin
        // frame around it.
        window.location.href = getAppUrl(storeHash, "/huntry/sponsors");
      }
    });
  };

  return (
    <Panel header={`Edit Sponsor: ${sponsor.name}`} style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
      <SponsorFormFields
        logoPreviewUrl={sponsor.logoUrl ?? DEFAULT_SPONSOR_LOGO_URL}
        onChange={handleChange}
        state={state}
      />

      <Flex flexGap="0.5rem" justifyContent="flex-end">
        <Button
          onClick={() => {
            // See handleSubmit's identical comment on why this is a hard
            // navigation rather than router.push.
            window.location.href = getAppUrl(storeHash, "/huntry/sponsors");
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
