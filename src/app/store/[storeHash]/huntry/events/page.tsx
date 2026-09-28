import { Suspense } from "react";
import { AuthorizedPage } from "@/components/layout/authorized-page";
import { ContentFallback } from "@/components/layout/content-fallback";
import { EventsPage } from "@/components/huntry/events/list/events-page";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ContentFallback />}>
      {/* Content fallback because AuthorizedPage must perform auth check based on session cookie */}
      <AuthorizedPage params={params} searchParams={searchParams} pageComponent={EventsPage} />
    </Suspense>
  );
}
