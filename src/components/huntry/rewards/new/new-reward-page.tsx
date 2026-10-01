import { Box } from "@bigcommerce/big-design";
import { NewRewardForm } from "@/components/huntry/rewards/new/new-reward-form";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Fetches the sponsor dropdown's options server-side, unlike
// NewSponsorPage/NewEventPage — neither of those forms depends on another
// Huntry concept's list. Only direction-sorted, no pagination: the sponsor
// dropdown is a plain <select>, not a searchable picker like ProductPicker,
// matching the WP form's own plain <select> for "Select Sponsor."
export async function NewRewardPage({
  params,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = await params;
  const storeHash = resolvedParams.storeHash;
  const storeHashString = Array.isArray(storeHash) ? storeHash[0] : storeHash;

  const sponsors = await fetchSponsors({ direction: "ASC" }, storeHashString);

  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <NewRewardForm sponsors={sponsors} />
    </Box>
  );
}
