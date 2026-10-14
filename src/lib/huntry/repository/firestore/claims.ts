import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { createFirestoreClaimRateLimitRepository } from "@/lib/huntry/repository/firestore/claim-rate-limit";
import { createFirestoreClaimRecordsRepository } from "@/lib/huntry/repository/firestore/claim-records";
import { createFirestoreGameActivityRepository } from "@/lib/huntry/repository/firestore/game-activity";
import { createFirestoreLeaderboardRepository } from "@/lib/huntry/repository/firestore/leaderboard";
import { createFirestorePlayerClaimRepository } from "@/lib/huntry/repository/firestore/player-claim";
import { createFirestoreRedemptionRepository } from "@/lib/huntry/repository/firestore/redemption";
import type { ClaimsRepository } from "@/lib/huntry/repository/types";

// The claims concept is large, so each part lives in its own file and is
// composed here, mirroring repository/sql/claims.ts.
export function createFirestoreClaimsRepository(getDb: () => Firestore = getFirestoreDb): ClaimsRepository {
  return {
    ...createFirestoreGameActivityRepository(getDb),
    ...createFirestoreLeaderboardRepository(getDb),
    ...createFirestoreClaimRateLimitRepository(getDb),
    ...createFirestoreRedemptionRepository(getDb),
    ...createFirestoreClaimRecordsRepository(getDb),
    ...createFirestorePlayerClaimRepository(getDb),
  };
}
