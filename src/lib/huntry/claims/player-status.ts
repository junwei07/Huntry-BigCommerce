import { listClaimsForCustomer } from "@/lib/huntry/claims/claims-api";
import { MAX_PLAYERS_PER_EVENT } from "@/lib/huntry/claims/limits";
import { fetchPlayerCount } from "@/lib/huntry/claims/leaderboard";

// Pre-check for the storefront map: is the hunt closed to this customer? Mirrors
// the `player_limit_reached` rule in evaluateClaim (player-claim.ts) — the event
// is at its cap and the customer holds no claim in it yet — but only informs the
// UI; the claims route stays the authoritative gate.
export async function getPlayerStatus(
  storeHash: string,
  eventId: number,
  bcCustomerId: number,
): Promise<{ full: boolean }> {
  const [playerCount, claims] = await Promise.all([
    fetchPlayerCount(eventId, storeHash),
    listClaimsForCustomer(storeHash, bcCustomerId),
  ]);

  return { full: playerCount >= MAX_PLAYERS_PER_EVENT && !claims.some((claim) => claim.eventId === eventId) };
}
