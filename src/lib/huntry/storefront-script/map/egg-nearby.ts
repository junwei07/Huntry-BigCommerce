import { findClaimableEgg, findNearbyRevisitableEgg, findUnseenClaimedEgg, NearbyEgg } from "../proximity";
import { EggFlags, StorefrontEgg } from "../types";

// What the player is standing next to. Mirrors the legacy geolocate handler
// (huntry-frontend-map.js L901-929): a claimable egg wins, then a claimed
// egg whose "fully claimed" notice they haven't dismissed, then a revisitable one. Dialogs are
// BC-HUN-037; the map only reports this through the huntry:egg-nearby event.
export type EggNearbyKind = "claimable" | "claimed-unseen" | "revisitable";

export interface EggNearby {
  kind: EggNearbyKind;
  egg: StorefrontEgg;
  distance: number;
  // An egg the player can reopen from the notification button (skipped, or
  // claimed-and-dismissed, or claimed by them), independent of `kind`.
  revisitable: NearbyEgg | null;
  lat: number;
  lng: number;
}

export function evaluateNearby(
  eggs: StorefrontEgg[],
  lat: number,
  lng: number,
  radiusMeters: number,
  flags: EggFlags,
): EggNearby | null {
  const revisitable = findNearbyRevisitableEgg(eggs, lat, lng, radiusMeters, flags);
  const claimable = findClaimableEgg(eggs, lat, lng, radiusMeters, flags);
  const unseen = claimable ? null : findUnseenClaimedEgg(eggs, lat, lng, radiusMeters, flags);
  const primary = claimable ?? unseen;

  if (!primary) {
    // Nothing to prompt about, but 037 may still want the revisit hint.
    return revisitable
      ? { kind: "revisitable", egg: revisitable.egg, distance: revisitable.distance, revisitable, lat, lng }
      : null;
  }

  return {
    kind: claimable ? "claimable" : "claimed-unseen",
    egg: primary.egg,
    distance: primary.distance,
    revisitable,
    lat,
    lng,
  };
}

// GPS fixes arrive continuously with trackUserLocation, so without this the
// event (and any dialog 037 opens from it) would fire on every fix. It emits
// only when the {kind, egg} pair changes; losing the egg (leaving the radius)
// re-arms it, and rearm() forgets the last value so the next fix re-emits.
export function createNearbyTracker() {
  let lastKey: string | null = null;

  return {
    next(current: EggNearby | null): EggNearby | null {
      const key = current ? `${current.kind}:${current.egg.id}` : null;

      if (key === lastKey) {
        return null;
      }

      lastKey = key;

      return current;
    },
    rearm(): void {
      lastKey = null;
    },
  };
}
