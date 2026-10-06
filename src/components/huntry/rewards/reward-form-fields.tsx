"use client";

import { Box, Flex, FlexItem, Input, Textarea } from "@bigcommerce/big-design";
import { FormSelect } from "@/components/ui/form-select";
import { ProductPicker } from "@/components/huntry/rewards/product-picker";
import { RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { HuntrySponsor } from "@/lib/huntry/sponsors/types";

const DISCOUNT_TYPE_OPTIONS = [
  { value: "fixed_cart", content: "Fixed amount off" },
  { value: "percent", content: "Percentage off" },
] as const;

const DISCOUNT_SCOPE_OPTIONS = [
  { value: "all", content: "Everything in the store" },
  { value: "specific", content: "Specific products" },
] as const;

// Shared by new-reward-form.tsx (create) and edit-reward-form.tsx (edit) —
// one state object + one patch-merging onChange, mirroring
// EventFormFields/SponsorFormFields rather than ~10 individual
// value/onChange props. Field order matches
// huntry/includes/rewards/meta-box.php's huntry_render_reward_details_meta_box()
// exactly (see docs/HUNTRY-UI-REFERENCE.md): Description, Sponsor, Start/
// Expiry dates, Number of Eggs, Gift Card Code, Discount Type, Value, Can be
// used on (scope) + Products. Name is the WP post title, not part of the meta box
// itself, but still the form's first field here, matching events'/sponsors'
// own precedent for the same WP-post-title mapping.
//
export function RewardFormFields({
  state,
  onChange,
  sponsors,
}: {
  state: RewardFormInput;
  onChange: (patch: Partial<RewardFormInput>) => void;
  sponsors: HuntrySponsor[];
}) {
  const sponsorOptions = [
    { value: "", content: "None" },
    ...sponsors.map((sponsor) => ({ value: String(sponsor.id), content: sponsor.name })),
  ];

  return (
    <>
      <Box marginBottom="medium">
        <Input label="Name" onChange={(event) => onChange({ name: event.target.value })} required value={state.name} />
      </Box>

      <Box marginBottom="medium">
        <Textarea
          label="Reward Description"
          onChange={(event) => onChange({ description: event.target.value })}
          required
          rows={3}
          value={state.description}
        />
      </Box>

      <Box marginBottom="medium">
        <FormSelect
          label="Select Sponsor"
          onOptionChange={(value) => onChange({ sponsorId: value ?? "" })}
          options={sponsorOptions}
          value={state.sponsorId}
        />
      </Box>

      <Box marginBottom="medium">
        <Flex flexGap="1rem">
          <FlexItem flexGrow={1}>
            <Input
              label="Start date"
              onChange={(event) => onChange({ rewardStartsAt: event.target.value })}
              required
              type="datetime-local"
              value={state.rewardStartsAt}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              label="Expiry Date"
              onChange={(event) => onChange({ rewardExpiresAt: event.target.value })}
              required
              type="datetime-local"
              value={state.rewardExpiresAt}
            />
          </FlexItem>
        </Flex>
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Number of Eggs"
          onChange={(event) => onChange({ eggCapacity: event.target.value })}
          required
          type="number"
          value={state.eggCapacity}
        />
      </Box>

      <Box marginBottom="medium">
        <Input
          label="Gift Card Code"
          onChange={(event) => onChange({ couponCode: event.target.value })}
          placeholder="Enter gift card code"
          required
          value={state.couponCode}
        />
      </Box>

      <Box marginBottom="medium">
        <Flex flexGap="1rem">
          <FlexItem flexGrow={1}>
            <FormSelect
              label="Discount Type"
              onOptionChange={(value) => value && onChange({ discountType: value })}
              options={[...DISCOUNT_TYPE_OPTIONS]}
              value={state.discountType}
            />
          </FlexItem>
          <FlexItem flexGrow={1}>
            <Input
              label="Value"
              onChange={(event) => onChange({ discountValue: event.target.value })}
              required
              step="0.01"
              type="number"
              value={state.discountValue}
            />
          </FlexItem>
        </Flex>
      </Box>

      <Box marginBottom="medium">
        <FormSelect
          label="Can be used on"
          onOptionChange={(value) => value && onChange({ discountScope: value })}
          options={[...DISCOUNT_SCOPE_OPTIONS]}
          value={state.discountScope}
        />
      </Box>

      {state.discountScope === "specific" && (
        <ProductPicker onChange={(productIds) => onChange({ productIds })} productIds={state.productIds} />
      )}
    </>
  );
}
