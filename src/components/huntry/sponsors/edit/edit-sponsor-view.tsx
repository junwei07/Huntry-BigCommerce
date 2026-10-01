import { notFound } from "next/navigation";
import { EditSponsorForm } from "@/components/huntry/sponsors/edit/edit-sponsor-form";
import { fetchSponsor } from "@/lib/huntry/sponsors/sponsors-api";

// Mirrors EditEventView: fetchSponsor returns undefined for a
// missing/foreign-store id (never throws), so notFound() is a direct check
// here.
export async function EditSponsorView({ id, storeHash }: { id: number; storeHash: string | undefined }) {
  // A non-numeric id (malformed URL) is treated the same as "not found"
  // rather than querying the DB with NaN.
  if (!Number.isInteger(id)) {
    notFound();
  }

  const sponsor = await fetchSponsor(id, storeHash);

  if (!sponsor) {
    notFound();
  }

  return <EditSponsorForm sponsor={sponsor} />;
}
