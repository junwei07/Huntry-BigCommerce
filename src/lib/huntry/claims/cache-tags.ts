// One shared tag for every claim list (BC-HUN-039's leaderboard/game
// activity will read under it). Mirrors eggs/cache-tags.ts.
export const CLAIMS_LIST_TAG = "huntry-claim:list";

// Per-event tag for the admin Map tab's claim counts, so one event's claim
// never invalidates another's cached view. Tagged by MapView, expired by the
// public claim route (revalidateTag — it isn't a Server Action) and by Force Claim.
export function eventClaimsTag(eventId: number | string): string {
  return `huntry-claim:event:${eventId}`;
}
