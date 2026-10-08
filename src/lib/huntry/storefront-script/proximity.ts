import { haversineMeters } from "./map-utils";
import { EggFlags, StorefrontEgg } from "./types";

export interface NearbyEgg {
  egg: StorefrontEgg;
  distance: number;
}

// Ported from huntry-frontend-map.js findClaimableEgg / findUnseenClaimedEgg /
// findNearbyRevisitableEgg, made pure: eggs, radius and flags are passed in.
// An egg counts as "claimed" when it is full (public map-data) or this player
// holds it (flags.mine).
function nearestWithin(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  radiusMeters: number,
  include: (egg: StorefrontEgg) => boolean,
): NearbyEgg | null {
  let best: NearbyEgg | null = null;

  for (const egg of eggs) {
    if (!egg.id || !include(egg)) continue;

    const distance = haversineMeters(lat, lng, egg.lat, egg.lng);

    if (distance <= radiusMeters && (!best || distance < best.distance)) {
      best = { egg, distance };
    }
  }

  return best;
}

const isClaimed = (egg: StorefrontEgg, flags: EggFlags): boolean => egg.isFull || flags.mine.has(egg.id);

// Closest egg the player can still claim and hasn't dismissed.
export function findClaimableEgg(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  radiusMeters: number,
  flags: EggFlags,
): NearbyEgg | null {
  return nearestWithin(
    eggs,
    lat,
    lng,
    radiusMeters,
    (egg) => !isClaimed(egg, flags) && !flags.dismissed.has(egg.id),
  );
}

// Closest egg claimed by someone else whose "fully claimed" dialog the player
// hasn't dismissed yet.
export function findUnseenClaimedEgg(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  radiusMeters: number,
  flags: EggFlags,
): NearbyEgg | null {
  return nearestWithin(
    eggs,
    lat,
    lng,
    radiusMeters,
    (egg) => isClaimed(egg, flags) && !flags.claimedDismissed.has(egg.id) && !flags.mine.has(egg.id),
  );
}

// Closest egg the player can reopen: one they skipped, one claimed by others
// whose dialog they dismissed, or one they claimed themselves.
export function findNearbyRevisitableEgg(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  radiusMeters: number,
  flags: EggFlags,
): NearbyEgg | null {
  return nearestWithin(eggs, lat, lng, radiusMeters, (egg) => {
    const claimed = isClaimed(egg, flags);

    return (
      (flags.skipped.has(egg.id) && !claimed) ||
      (claimed && flags.claimedDismissed.has(egg.id)) ||
      flags.mine.has(egg.id)
    );
  });
}

// Distance to the closest egg the player could still claim, for the "nearest
// egg" readout (legacy updateNearestTreasure, huntry-frontend-map.js L450).
// Null when nothing is left to find.
export function nearestUnclaimedDistance(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  flags: EggFlags,
): number | null {
  let best: number | null = null;

  for (const egg of eggs) {
    if (!egg.id || isClaimed(egg, flags)) continue;

    const distance = haversineMeters(lat, lng, egg.lat, egg.lng);

    if (best === null || distance < best) {
      best = distance;
    }
  }

  return best;
}
