import { redirect } from "next/navigation";
import { Box } from "@bigcommerce/big-design";
import { NewEventForm } from "@/components/huntry/events/new/new-event-form";
import { countEvents } from "@/lib/huntry/events/events-api";
import { MAX_EVENTS } from "@/lib/huntry/events/limits";
import { getAppUrl } from "@/lib/routing/app-url";

type PageProps = {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function NewEventPage({ params }: PageProps) {
  const { storeHash } = await params;
  const storeHashString = Array.isArray(storeHash) ? storeHash[0] : storeHash;

  // Direct-URL guard for the one-event limit (createHuntryEvent is the real
  // gate) — mirrors the WP plugin redirecting load-post-new.php back to the list.
  if ((await countEvents(storeHashString)) >= MAX_EVENTS) {
    redirect(getAppUrl(storeHashString, "/huntry/events"));
  }

  return (
    <Box padding="medium">
      <NewEventForm />
    </Box>
  );
}
