import { Box } from "@bigcommerce/big-design";
import { FeaturedForm } from "@/components/huntry/featured/featured-form";
import { fetchStorefrontSettings } from "@/lib/huntry/featured/featured-api";

export async function FeaturedView({ storeHash }: { storeHash: string | undefined }) {
  const settings = await fetchStorefrontSettings(storeHash);

  return (
    <Box padding="medium">
      <FeaturedForm initial={settings} />
    </Box>
  );
}
