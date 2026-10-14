import { resolveCredentialsStoreDriver } from "@/lib/huntry/db/resolve-driver";
import { sqlClaimsRepository } from "@/lib/huntry/repository/sql/claims";
import { sqlEggsRepository } from "@/lib/huntry/repository/sql/eggs";
import { sqlEventsRepository } from "@/lib/huntry/repository/sql/events";
import { sqlFeaturedRepository } from "@/lib/huntry/repository/sql/featured";
import { sqlRewardsRepository } from "@/lib/huntry/repository/sql/rewards";
import { sqlSponsorsRepository } from "@/lib/huntry/repository/sql/sponsors";
import type { HuntryRepository } from "@/lib/huntry/repository/types";

const sqlRepository: HuntryRepository = {
  featured: sqlFeaturedRepository,
  sponsors: sqlSponsorsRepository,
  eggs: sqlEggsRepository,
  events: sqlEventsRepository,
  rewards: sqlRewardsRepository,
  claims: sqlClaimsRepository,
};

// Selects the Huntry storage implementation from the same
// CREDENTIALS_STORE_DRIVER that governs credentials (shared resolver, so the two
// can't diverge). The SQL implementation serves SQLITE and POSTGRES; it picks
// between them itself through getHuntryDb(), which also rejects D1.
export function getHuntryRepository(): HuntryRepository {
  const driver = resolveCredentialsStoreDriver();

  switch (driver) {
    case "SQLITE":
    case "POSTGRES":
      return sqlRepository;
    case "D1":
      throw new Error(
        "getHuntryRepository: the D1 driver is not yet supported for Huntry's own database " +
          "(CREDENTIALS_STORE_DRIVER=D1 is only valid for credentials-store so far).",
      );
  }
}
