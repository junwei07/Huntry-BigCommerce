"use client";

import { useState, useTransition } from "react";
import { Button, Flex, Panel } from "@bigcommerce/big-design";
import { updateHuntryReward } from "@/app/store/[storeHash]/huntry/rewards/[id]/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { RewardFormFields } from "@/components/huntry/rewards/reward-form-fields";
import { toDatetimeLocalValue } from "@/lib/huntry/events/datetime-local";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";
import { RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";
import { getAppUrl } from "@/lib/routing/app-url";

// toDatetimeLocalValue lives under events/ (it predates rewards), but it's
// generic date-formatting with nothing events-specific about it — reused
// directly rather than duplicated here.
function toFormState(reward: HuntryReward): RewardFormInput {
  return {
    name: reward.name,
    description: reward.description,
    sponsorId: reward.sponsorId ? String(reward.sponsorId) : "",
    rewardStartsAt: reward.rewardStartsAt ? toDatetimeLocalValue(reward.rewardStartsAt) : "",
    rewardExpiresAt: reward.rewardExpiresAt ? toDatetimeLocalValue(reward.rewardExpiresAt) : "",
    eggCapacity: String(reward.eggCapacity),
    discountType: reward.discountType,
    discountValue: String(reward.discountValue),
    discountScope: reward.discountScope,
    productIds: reward.productIds,
  };
}

export function EditRewardForm({ reward, sponsors }: { reward: HuntryReward; sponsors: HuntrySponsor[] }) {
  // This is RewardActionsMenu's destination for a useGlobalTransition({
  // autoResolve: false }) navigation — see its comment. Marks the full-page
  // overlay done once this real form is actually showing, mirroring
  // NewRewardForm's precedent.
  useClearGlobalLoading();

  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<RewardFormInput>(() => toFormState(reward));

  const handleChange = (patch: Partial<RewardFormInput>) => setState((current) => ({ ...current, ...patch }));

  const canSubmit =
    state.name.trim() !== "" &&
    state.description.trim() !== "" &&
    state.rewardStartsAt !== "" &&
    state.rewardExpiresAt !== "" &&
    state.eggCapacity !== "" &&
    state.discountValue !== "" &&
    (state.discountScope !== "specific" || state.productIds.length > 0);

  const handleSubmit = () => {
    startTransition(async () => {
      const result = await runServerAction(() => updateHuntryReward(reward.id, state, storeHash));

      if (result.success) {
        // A hard, iframe-scoped navigation rather than router.push —
        // leaving this dynamic [id] route via a client-side transition can
        // get permanently stuck re-rendering this same edit form (no
        // error, only a hard refresh recovers; router.push + router.refresh
        // was tried first and didn't fix it either). window.location (not
        // window.top.location — see control-panel-link.tsx) only reloads
        // this app's own iframe content, never BigCommerce's own admin
        // frame around it.
        window.location.href = getAppUrl(storeHash, "/huntry/rewards");
      }
    });
  };

  return (
    <Panel header={`Edit Reward: ${reward.name}`} style={{ backgroundColor: "#FFFFFF", borderRadius: "16px" }}>
      <RewardFormFields couponCode={reward.couponCode} onChange={handleChange} sponsors={sponsors} state={state} />

      <Flex flexGap="0.5rem" justifyContent="flex-end">
        <Button
          onClick={() => {
            // See handleSubmit's identical comment on why this is a hard
            // navigation rather than router.push.
            window.location.href = getAppUrl(storeHash, "/huntry/rewards");
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
