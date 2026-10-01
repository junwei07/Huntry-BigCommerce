import { notFound } from "next/navigation";
import { EditEventForm } from "@/components/huntry/events/edit/edit-event-form";
import { fetchEvent } from "@/lib/huntry/events/events-api";

// Uses fetchEvent's cached read (not fetchEventUncached — that's for the
// Server Action right before a write) since this is a page render like any
// other. fetchEvent returns undefined for a missing/foreign-store id
// (never throws), so notFound() is a direct check here, unlike
// GiftCertificateView's try/catch (which exists because BigCommerce's own
// REST 404 throws an AppError instead).
export async function EditEventView({ id, storeHash }: { id: number; storeHash: string | undefined }) {
  // A non-numeric id (malformed URL) is treated the same as "not found"
  // rather than querying the DB with NaN.
  if (!Number.isInteger(id)) {
    notFound();
  }

  const event = await fetchEvent(id, storeHash);

  if (!event) {
    notFound();
  }

  return <EditEventForm event={event} />;
}
