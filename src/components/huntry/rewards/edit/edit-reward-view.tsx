import { notFound } from "next/navigation";
import { EditRewardForm } from "@/components/huntry/rewards/edit/edit-reward-form";
import { fetchReward } from "@/lib/huntry/rewards/rewards-api";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";

// Mirrors EditSponsorView/EditEventView: fetchReward returns undefined for a
// missing/foreign-store id (never throws), so notFound() is a direct check
// here. Also fetches sponsors for the form's dropdown, the same way
// NewRewardPage does for creation.
export async function EditRewardView({ id, storeHash }: { id: number; storeHash: string | undefined }) {
  // A non-numeric id (malformed URL) is treated the same as "not found"
  // rather than querying the DB with NaN.
  if (!Number.isInteger(id)) {
    notFound();
  }

  const [reward, sponsors] = await Promise.all([fetchReward(id, storeHash), fetchSponsors({ direction: "ASC" }, storeHash)]);

  if (!reward) {
    notFound();
  }

  return <EditRewardForm reward={reward} sponsors={sponsors} />;
}
