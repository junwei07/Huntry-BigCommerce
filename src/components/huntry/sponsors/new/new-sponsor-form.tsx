"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { createHuntrySponsor } from "@/app/store/[storeHash]/huntry/sponsors/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { SponsorFormFields } from "@/components/huntry/sponsors/sponsor-form-fields";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { DEFAULT_SPONSOR_LOGO_URL } from "@/lib/huntry/sponsors/types";
import { getAppUrl } from "@/lib/routing/app-url";

const INITIAL_STATE: SponsorFormInput = {
  name: "",
  instagramUrl: "",
  facebookUrl: "",
  websiteUrl: "",
  location: "",
};

// This is NewSponsorButton's destination for a useGlobalTransition({
// autoResolve: false }) navigation — see its comment. useClearGlobalLoading
// marks the full-page overlay done once this real form is actually showing,
// mirroring NewEventForm's precedent.
export function NewSponsorForm() {
  useClearGlobalLoading();

  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SponsorFormInput>(INITIAL_STATE);

  const handleChange = (patch: Partial<SponsorFormInput>) => setState((current) => ({ ...current, ...patch }));

  // Name is the only required field in the WP source form (everything else
  // is optional) — see docs/HUNTRY-UI-REFERENCE.md.
  const canSubmit = state.name.trim() !== "";

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => createHuntrySponsor(state, storeHash));

      if (result.success) {
        router.push(getAppUrl(storeHash, "/huntry/sponsors"));
      }
    });
  };

  return (
    <Panel header="Create Sponsor" style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
      <SponsorFormFields logoPreviewUrl={DEFAULT_SPONSOR_LOGO_URL} onChange={handleChange} state={state} />

      <Flex flexGap="0.5rem" justifyContent="flex-end">
        <Button onClick={() => router.push(getAppUrl(storeHash, "/huntry/sponsors"))} variant="subtle">
          Cancel
        </Button>
        <Button
          disabled={!canSubmit}
          isLoading={isPending}
          onClick={handleSubmit}
          style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
          variant="primary"
        >
          Create Sponsor
        </Button>
      </Flex>
    </Panel>
  );
}
