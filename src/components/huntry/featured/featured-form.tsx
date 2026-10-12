"use client";

import { useState, useTransition } from "react";
import { Box, Button, Flex, Input, Panel, Small } from "@bigcommerce/big-design";
import { saveHuntryFeaturedSettings } from "@/app/store/[storeHash]/huntry/featured/actions";
import { runServerAction } from "@/components/ui/action-alerts";
import { useClearGlobalLoading } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { LogoUploadField } from "@/components/huntry/sponsors/logo-upload-field";
import { FeaturedFormInput } from "@/lib/huntry/featured/featured-form-schema";
import {
  BANNER_DESCRIPTION_PLACEHOLDER,
  DEFAULT_BANNER_IMAGE_URL,
  DEFAULT_BANNER_LOGO_URL,
  PRODUCT_CTA_DESCRIPTION_PLACEHOLDER,
  PRODUCT_CTA_TITLE_PLACEHOLDER,
  StorefrontSettings,
} from "@/lib/huntry/featured/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const PANEL_STYLE = { backgroundColor: "#FFFFFF", borderRadius: "16px", marginBottom: "1rem" };
const IMAGE_CAPTION = "Preview only — image uploads aren't stored yet. The default image is used on the storefront.";

// Port of the plugin's Featured page (huntry/includes/featured/index.php),
// minus the featured-event picker: every live event gets a banner slide, since
// the per-event featured flag isn't built yet (tickets.md, BC-HUN-015). The
// button text itself ("LIVE · JOIN NOW") is driven by event timing, not
// editable here. Blank text means "use the default copy" (the placeholder).
export function FeaturedForm({ initial }: { initial: StorefrontSettings }) {
  useClearGlobalLoading();

  const storeHash = useStoreHash();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<FeaturedFormInput>({ ...initial });

  const handleChange = (patch: Partial<FeaturedFormInput>) => setState((current) => ({ ...current, ...patch }));

  const handleSubmit = () => {
    startTransition(async () => {
      await runServerAction(() => saveHuntryFeaturedSettings(state, storeHash));
    });
  };

  return (
    <>
      <Panel header="Header banner" style={PANEL_STYLE}>
        <Small marginBottom="medium" style={{ color: HUNTRY_COLORS.textMuted }}>
          Customize the storefront header banner&apos;s description text and images. Every live event gets its own
          slide. The button&apos;s own text is driven by event timing and isn&apos;t editable here.
        </Small>

        <Box marginBottom="medium">
          <Input
            description="Leave empty to use the default."
            label="Banner description"
            maxLength={120}
            onChange={(event) => handleChange({ bannerDescription: event.target.value })}
            placeholder={BANNER_DESCRIPTION_PLACEHOLDER}
            value={state.bannerDescription}
          />
        </Box>

        <Flex flexGap="1.5rem" flexWrap="wrap">
          <LogoUploadField
            altText="Banner button logo preview"
            ariaLabel="Change banner button logo"
            caption={IMAGE_CAPTION}
            label="Button logo"
            previewUrl={DEFAULT_BANNER_LOGO_URL}
          />
          <LogoUploadField
            altText="Banner image preview"
            ariaLabel="Change banner image"
            caption={IMAGE_CAPTION}
            label="Banner image"
            previewUrl={DEFAULT_BANNER_IMAGE_URL}
            width="240px"
          />
        </Flex>
      </Panel>

      <Panel header="Product page CTA" style={PANEL_STYLE}>
        <Small marginBottom="medium" style={{ color: HUNTRY_COLORS.textMuted }}>
          Customize the title and description of the rewards banner shown on a product page when that product is
          covered by a reward in a live hunt.
        </Small>

        <Box marginBottom="medium">
          <Input
            description="Leave empty to use the default."
            label="Title"
            maxLength={120}
            onChange={(event) => handleChange({ productCtaTitle: event.target.value })}
            placeholder={PRODUCT_CTA_TITLE_PLACEHOLDER}
            value={state.productCtaTitle}
          />
        </Box>

        <Box marginBottom="medium">
          <Input
            description="Leave empty to use the default."
            label="Description"
            maxLength={240}
            onChange={(event) => handleChange({ productCtaDescription: event.target.value })}
            placeholder={PRODUCT_CTA_DESCRIPTION_PLACEHOLDER}
            value={state.productCtaDescription}
          />
        </Box>
      </Panel>

      <Flex justifyContent="flex-end">
        <Button
          isLoading={isPending}
          onClick={handleSubmit}
          style={{ backgroundColor: HUNTRY_COLORS.primary, borderColor: HUNTRY_COLORS.primary }}
          variant="primary"
        >
          Save Changes
        </Button>
      </Flex>
    </>
  );
}
