"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { createHuntryReward } from "@/app/store/[storeHash]/huntry/rewards/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { Breadcrumb } from "@/components/huntry/breadcrumb";
import { RewardFormFields } from "@/components/huntry/rewards/reward-form-fields";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { getAppUrl } from "@/lib/routing/app-url";

const INITIAL_STATE: RewardFormInput = {
  name: "",
  description: "",
  sponsorId: "",
  couponCode: "",
  rewardStartsAt: "",
  rewardExpiresAt: "",
  eggCapacity: "1",
  discountType: "fixed_cart",
  discountValue: "",
  discountScope: "all",
  productIds: [],
};

// This is NewRewardButton's destination for a useGlobalTransition({
// autoResolve: false }) navigation — see its comment. useClearGlobalLoading
// marks the full-page overlay done once this real form is actually showing,
// mirroring NewEventForm/NewSponsorForm's precedent.
export function NewRewardForm({ sponsors }: { sponsors: HuntrySponsor[] }) {
  useClearGlobalLoading();

  const router = useRouter();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<RewardFormInput>(INITIAL_STATE);

  const handleChange = (patch: Partial<RewardFormInput>) => setState((current) => ({ ...current, ...patch }));

  // Mirrors the WP form's required fields (see RewardFormFields/
  // reward-form-schema.ts) — a client-side approximation only; the Server
  // Action's zod schema is the authoritative check (including the
  // expiry-after-start and products-required-when-specific refinements this
  // simple boolean doesn't attempt to replicate).
  const canSubmit =
    state.name.trim() !== "" &&
    state.description.trim() !== "" &&
    state.couponCode.trim() !== "" &&
    state.rewardStartsAt !== "" &&
    state.rewardExpiresAt !== "" &&
    state.eggCapacity !== "" &&
    state.discountValue !== "" &&
    (state.discountScope !== "specific" || state.productIds.length > 0);

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => createHuntryReward(state, storeHash));

      if (result.success) {
        router.push(getAppUrl(storeHash, "/huntry/rewards"));
      }
    });
  };

  return (
    <>
      <Breadcrumb
        crumbs={[{ label: "Rewards", href: getAppUrl(storeHash, "/huntry/rewards") }, { label: "Add New Reward" }]}
      />
      <Panel header="Create Reward" style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
        <RewardFormFields onChange={handleChange} sponsors={sponsors} state={state} />

        <Flex flexGap="0.5rem" justifyContent="flex-end">
          <Button onClick={() => router.push(getAppUrl(storeHash, "/huntry/rewards"))} variant="subtle">
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            isLoading={isPending}
            onClick={handleSubmit}
            style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
            variant="primary"
          >
            Create Reward
          </Button>
        </Flex>
      </Panel>
    </>
  );
}
