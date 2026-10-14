import { sqlClaimRateLimitRepository } from "@/lib/huntry/repository/sql/claim-rate-limit";
import { sqlClaimRecordsRepository } from "@/lib/huntry/repository/sql/claim-records";
import { sqlGameActivityRepository } from "@/lib/huntry/repository/sql/game-activity";
import { sqlLeaderboardRepository } from "@/lib/huntry/repository/sql/leaderboard";
import { sqlPlayerClaimRepository } from "@/lib/huntry/repository/sql/player-claim";
import { sqlRedemptionRepository } from "@/lib/huntry/repository/sql/redemption";
import type { ClaimsRepository } from "@/lib/huntry/repository/types";

// The claims concept is large, so each part lives in its own file and is
// composed here.
export const sqlClaimsRepository: ClaimsRepository = {
  ...sqlGameActivityRepository,
  ...sqlLeaderboardRepository,
  ...sqlClaimRateLimitRepository,
  ...sqlRedemptionRepository,
  ...sqlClaimRecordsRepository,
  ...sqlPlayerClaimRepository,
};
