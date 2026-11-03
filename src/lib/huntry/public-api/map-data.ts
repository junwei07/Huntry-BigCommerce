import { fetchFullEggIds } from "@/lib/huntry/claims/claims-api";
import { fetchEggs } from "@/lib/huntry/eggs/eggs-api";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import {
  locationMarkerAnchor,
  resolveItemMarkerClaimedUrl,
  resolveItemMarkerUrl,
  resolveLocationMarkerUrl,
} from "@/lib/huntry/events/marker-urls";
import { EventThemeColors, HuntryEvent } from "@/lib/huntry/events/types";
import { fetchReward } from "@/lib/huntry/rewards/rewards-api";
import { getAbsoluteAppUrl } from "@/lib/routing/app-url";

// The public, unauthenticated shape of GET .../map-data. Built field by field
// from an explicit whitelist — never by spreading a DB row — so a column added
// later can't leak. Deliberately absent: storeHash, coupon codes, every bc_*
// id and discount detail (the coupon is only released by the claim route).
export interface PublicMapEgg {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rewardName: string;
  // Reached the event's per-egg claim capacity. A per-player "claimed by me"
  // flag needs the player's JWT, so it can't live in this public read.
  isFull: boolean;
}

export interface PublicMapEvent {
  id: number;
  name: string;
  slug: string;
  description: string;
  startsAt: Date | null;
  endsAt: Date | null;
  headerBannerUrl: string | null;
  markerRadiusMeters: number;
  maxGrabCount: number;
  eggClaimCapacity: number;
  colors: EventThemeColors;
  unclaimedIconUrl: string | null;
  claimedIconUrl: string | null;
  locationIconUrl: string | null;
  locationAnchor: "bottom" | "center";
  eggs: PublicMapEgg[];
}

// What the /huntry/ listing shows for a hunt that has not started: a card with a
// countdown, nothing more. Deliberately no id, eggs, rewards or locations — the
// hunt is not open yet, so none of that may be public.
export interface PublicUpcomingEvent {
  name: string;
  slug: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  headerBannerUrl: string | null;
}

export interface PublicMapData {
  events: PublicMapEvent[];
  // Never narrowed into `events`, so no map, claim or ?event= path can open one.
  upcoming: PublicUpcomingEvent[];
}

// The script runs on the merchant's domain, so a root-relative asset path
// (the bundled preset markers, e.g. /huntry/markers/item/sample_1.png) would
// resolve against *their* origin. Anchor those to APP_ORIGIN. Custom URLs are
// admin-typed: only http(s) is passed through, anything else (javascript:,
// data:) is dropped.
export function toPublicAssetUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  if (url.startsWith("/") && !url.startsWith("//")) {
    return getAbsoluteAppUrl(undefined, url);
  }

  return /^https?:\/\//i.test(url) ? url : null;
}

async function buildPublicEvent(event: HuntryEvent, storeHash: string): Promise<PublicMapEvent> {
  const [eggs, fullEggIds] = await Promise.all([
    fetchEggs(event.id, storeHash),
    fetchFullEggIds(event.id, event.eggClaimCapacity, storeHash),
  ]);

  const rewardIds = [...new Set(eggs.map((egg) => egg.rewardId))];
  const rewards = await Promise.all(rewardIds.map((rewardId) => fetchReward(rewardId, storeHash)));
  const rewardNames = new Map(rewards.flatMap((reward) => (reward ? [[reward.id, reward.name] as const] : [])));

  const { itemMarker, locationMarker, colors } = event.theme;

  return {
    id: event.id,
    name: event.name,
    slug: event.slug,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    headerBannerUrl: toPublicAssetUrl(event.headerBannerUrl),
    markerRadiusMeters: event.markerRadiusMeters,
    maxGrabCount: event.maxGrabCount,
    eggClaimCapacity: event.eggClaimCapacity,
    colors,
    unclaimedIconUrl: toPublicAssetUrl(resolveItemMarkerUrl(itemMarker)),
    claimedIconUrl: toPublicAssetUrl(resolveItemMarkerClaimedUrl(itemMarker)),
    locationIconUrl: toPublicAssetUrl(resolveLocationMarkerUrl(locationMarker)),
    locationAnchor: locationMarkerAnchor(locationMarker),
    eggs: eggs.map((egg) => ({
      id: egg.id,
      name: egg.name,
      lat: egg.lat,
      lng: egg.lng,
      rewardName: rewardNames.get(egg.rewardId) ?? "",
      isFull: fullEggIds.has(egg.id),
    })),
  };
}

// `events` is live events only (derived status; ended events and any eggs of a
// hunt that is not live are withheld), optionally narrowed to one event by slug.
// `upcoming` lists the not-yet-started events as eggless card data, and is empty
// when narrowed by slug.
export async function buildPublicMapData(storeHash: string, eventSlug?: string): Promise<PublicMapData> {
  const events = await fetchEvents({ sort: "time" }, storeHash);
  const live = events.filter((event) => event.status === "live" && (!eventSlug || event.slug === eventSlug));
  const upcoming = eventSlug
    ? []
    : events.flatMap((event) =>
        event.status === "upcoming" && event.startsAt
          ? [
              {
                name: event.name,
                slug: event.slug,
                description: event.description,
                startsAt: event.startsAt,
                endsAt: event.endsAt,
                headerBannerUrl: toPublicAssetUrl(event.headerBannerUrl),
              },
            ]
          : [],
      );

  return { events: await Promise.all(live.map((event) => buildPublicEvent(event, storeHash))), upcoming };
}
