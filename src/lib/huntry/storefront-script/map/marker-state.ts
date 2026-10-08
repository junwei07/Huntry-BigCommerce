import { StorefrontEgg, StorefrontEvent } from "../types";

export interface MarkerAppearance {
  claimed: boolean;
  // null means "no icon configured": use maplibre's stock pin in fallbackColor.
  iconUrl: string | null;
  fallbackColor: string;
}

// Legacy buildEggMarker (huntry-frontend-map.js L281): claimed eggs use the
// claimed icon and a grey pin, unclaimed eggs the item icon and an orange pin.
const CLAIMED_COLOR = "#999999";
const UNCLAIMED_COLOR = "#eb711b";

// An egg is claimed once it is full (public map-data) or this player holds it.
export function markerAppearance(
  egg: StorefrontEgg,
  event: Pick<StorefrontEvent, "unclaimedIconUrl" | "claimedIconUrl">,
  mine: ReadonlySet<string>,
): MarkerAppearance {
  const claimed = egg.isFull || mine.has(egg.id);

  return {
    claimed,
    iconUrl: claimed ? event.claimedIconUrl : event.unclaimedIconUrl,
    fallbackColor: claimed ? CLAIMED_COLOR : UNCLAIMED_COLOR,
  };
}
