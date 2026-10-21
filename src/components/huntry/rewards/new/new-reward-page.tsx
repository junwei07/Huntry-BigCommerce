import { redirect } from "next/navigation";
import { Box } from "@bigcommerce/big-design";
import { NewRewardForm } from "@/components/huntry/rewards/new/new-reward-form";
import { MAX_REWARDS } from "@/lib/huntry/rewards/limits";
import { countRewards } from "@/lib/huntry/rewards/rewards-api";
import { getAppUrl } from "@/lib/routing/app-url";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";

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

  // Direct-URL guard for the reward cap (createHuntryReward is the real gate).
  if ((await countRewards(storeHashString)) >= MAX_REWARDS) {
    redirect(getAppUrl(storeHashString, "/huntry/rewards"));
  }

  const sponsors = await fetchSponsors({ direction: "ASC" }, storeHashString);

  return (
    <Box padding="medium">
      <NewRewardForm sponsors={sponsors} />
    </Box>
  );
}
