import { Box, Flex, Panel, Text } from "@bigcommerce/big-design";
import { SponsorCard } from "@/components/huntry/sponsors/list/sponsor-card";
import { SponsorListHeader } from "@/components/huntry/sponsors/list/sponsor-list-header";
import { NewSponsorButton } from "@/components/huntry/sponsors/list/new-sponsor-button";
import { SortSelect } from "@/components/huntry/sponsors/list/sort-select";
import { PageTitle } from "@/components/huntry/page-title";
import { fetchSponsors } from "@/lib/huntry/sponsors/sponsors-api";
import { parseSponsorsQuery } from "@/lib/huntry/sponsors/query";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
// @cache-components-only:end

export async function SponsorListView({
  searchParams,
  storeHash,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  storeHash: string | undefined;
}) {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(SPONSORS_LIST_TAG);
  // @cache-components-only:end

  const query = parseSponsorsQuery(searchParams);
  const sponsors = await fetchSponsors(query, storeHash);

  // @cache-components-only:start
  for (const sponsor of sponsors) {
    cacheTag(sponsorTag(sponsor.id));
  }
  // @cache-components-only:end

  return (
    <Box padding="medium">
      <Panel style={{ backgroundColor: "transparent", border: "none", boxShadow: "none" }}>
        <PageTitle>Sponsors</PageTitle>
        <Flex alignItems="center" justifyContent="space-between" marginBottom="medium">
          <SortSelect query={query} />
          <NewSponsorButton />
        </Flex>

        <SponsorListHeader />

        {sponsors.length === 0 ? (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No sponsors yet.</Text>
        ) : (
          <Flex flexDirection="column" flexGap="0.75rem" marginTop="small">
            {sponsors.map((sponsor) => (
              <SponsorCard key={sponsor.id} sponsor={sponsor} />
            ))}
          </Flex>
        )}
      </Panel>
    </Box>
  );
}
