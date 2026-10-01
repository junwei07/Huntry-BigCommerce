import { Suspense } from "react";
import { AuthorizedPage } from "@/components/layout/authorized-page";
import { ContentFallback } from "@/components/layout/content-fallback";
import { NewRewardPage } from "@/components/huntry/rewards/new/new-reward-page";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<ContentFallback />}>
      <AuthorizedPage params={params} searchParams={searchParams} pageComponent={NewRewardPage} />
    </Suspense>
  );
}
