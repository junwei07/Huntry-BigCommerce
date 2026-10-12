// The admin Map tab's per-egg claim state (plugin: huntry/includes/map/page.php
// L1047-1090). "Claimed" means at least one claim, not "at capacity".
export interface EggClaimStatus {
  claimed: boolean;
  label: string;
  forced: boolean;
}

export function eggClaimStatus(
  counts: { count: number; forced: number } | undefined,
  claimCapacity: number,
): EggClaimStatus {
  const count = counts?.count ?? 0;

  return {
    claimed: count > 0,
    label: count > 0 ? `Claimed ${count}/${claimCapacity}` : "Not Claimed",
    forced: (counts?.forced ?? 0) > 0,
  };
}
