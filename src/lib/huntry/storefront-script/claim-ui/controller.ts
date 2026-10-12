import type { ClaimOutcome } from "../claim-outcome";
import type { HuntryStorefrontApi } from "../index";
import { FlagName, persistFlag } from "../local-state";
import type { EggNearby } from "../map/egg-nearby";
import type { NearbyEgg } from "../proximity";
import type { StorefrontEgg, StorefrontEvent } from "../types";
import { applyCouponToCart, CartResult } from "./cart";
import { describeOutcome, OutcomeAction } from "./outcomes";

// The claim flow, ported from the legacy geolocate handler and dialogs
// (huntry-frontend-map.js L313-333, L583-929). It has no DOM of its own: it
// drives a ClaimUi, so the decisions are unit-testable in plain Node.
//
// The rule that keeps one dialog from showing repeatedly: every way out of an
// auto-opened dialog writes a flag (Skip -> skipped + dismissed, "someone beat
// you to it" -> claimedDismissed), the map's proximity checks read those same
// sets, and from then on the egg is only reachable through the bell.
export interface FoundView {
  distanceMeters: number;
  onSkip: () => void;
  onClaim: (handle: FoundHandle) => void;
}

export interface FoundHandle {
  setBusy: (busy: boolean) => void;
  setMessage: (text: string) => void;
}

export interface ClaimedView {
  rewardName: string;
  couponCode: string;
  applyToCart: () => Promise<CartResult>;
  onKeepHunting: () => void;
}

export interface BlockedView {
  icon: string;
  title: string;
  message: string;
  onDismiss: () => void;
}

export interface ClaimUi {
  isOpen: () => boolean;
  showFound: (view: FoundView) => void;
  showClaimed: (view: ClaimedView) => void;
  showBlocked: (view: BlockedView) => void;
  showLogin: (onBack: () => void) => void;
  showLimit: () => void;
  setBadge: (visible: boolean) => void;
}

export interface ClaimController {
  handleNearby: (detail: EggNearby | null) => void;
  // The bell: reopen the dialog for the egg the player is standing next to.
  openRevisit: () => void;
}

type MapApi = NonNullable<HuntryStorefrontApi["map"]>;

export function createClaimController(
  api: Pick<HuntryStorefrontApi, "config" | "submitClaim"> & { map?: MapApi },
  event: StorefrontEvent,
  ui: ClaimUi,
  applyCoupon: (code: string) => Promise<CartResult> = applyCouponToCart,
): ClaimController {
  let limitReached = false;
  let claiming = false;
  // Where the player last was, for the claim POST when the map has no fix yet.
  let lastKnown: { lat: number; lng: number } | null = null;
  let revisit: NearbyEgg | null = null;

  const addFlag = (flag: FlagName, eggId: string) => {
    const set = api.map?.flags[flag];

    if (!set) return;

    set.add(eggId);
    persistFlag(api.config.storeHash, event.id, flag, set);
  };

  const claimedByMe = (egg: StorefrontEgg) => api.map?.flags.mine.has(egg.id) ?? false;

  // Called after every dialog closes. The tracker consumed this egg's key
  // while the dialog was open, so without a re-arm the next GPS fix would stay
  // silent and (for an unflagged egg) nothing would ever prompt again.
  const closed = () => {
    api.map?.rearm();
  };

  const setRevisit = (next: NearbyEgg | null) => {
    revisit = next;
    ui.setBadge(next !== null);
  };

  const showLimit = () => {
    limitReached = true;
    api.map?.setClaimLimitReached();
    ui.showLimit();
  };

  const openBlocked = (egg: StorefrontEgg, distance: number, mine: boolean) => {
    const action = describeOutcome(mine ? { kind: "already-claimed-by-me", couponCode: "" } : { kind: "full" });

    if (action.type !== "blocked") return;

    ui.showBlocked({
      icon: action.icon,
      title: action.title,
      message: action.message,
      onDismiss: () => {
        addFlag("claimedDismissed", egg.id);
        setRevisit({ egg, distance });
        closed();
      },
    });
  };

  const showClaimed = (egg: StorefrontEgg, couponCode: string) => {
    // Same test as legacy (L801): a proactive hint only. map-data has no
    // per-player count, so this is "claims made on this device"; the server's
    // limit_reached reply stays authoritative.
    const reachedLimit = event.maxGrabCount > 0 && (api.map?.flags.mine.size ?? 0) >= event.maxGrabCount;

    ui.showClaimed({
      rewardName: egg.rewardName,
      couponCode,
      applyToCart: () => applyCoupon(couponCode),
      onKeepHunting: () => {
        if (reachedLimit) {
          showLimit();
        } else {
          closed();
        }
      },
    });
  };

  const settle = (egg: StorefrontEgg, distance: number, handle: FoundHandle, action: OutcomeAction) => {
    switch (action.type) {
      case "claimed":
        // Adds the egg to `mine`, so it stops being claimable and the bell can reopen it.
        api.map?.markEggClaimed(egg.id);
        showClaimed(egg, action.couponCode);
        return;
      case "login":
        handle.setBusy(false);
        ui.showLogin(() => openFound(egg, distance));
        return;
      case "limit":
        addFlag("dismissed", egg.id);
        showLimit();
        return;
      case "blocked":
        if (action.reason === "mine") {
          // Duplicate: the egg is already ours. Without this it stays claimable and re-prompts.
          api.map?.markEggClaimed(egg.id);
        } else {
          addFlag("dismissed", egg.id);

          if (action.reason === "full") {
            // Treat it as claimed for the rest of the session (legacy claimedEggIds).
            egg.isFull = true;
            api.map?.refreshMarker(egg.id);
          }
        }

        ui.showBlocked({
          icon: action.icon,
          title: action.title,
          message: action.message,
          onDismiss: () => {
            // Only a claimed egg belongs behind the bell; a hunt that isn't live
            // or a withdrawn reward has nothing to reopen.
            if (action.reason === "full" || action.reason === "mine") {
              addFlag("claimedDismissed", egg.id);
              setRevisit({ egg, distance });
            }

            closed();
          },
        });
        return;
      case "inline":
        handle.setBusy(false);
        handle.setMessage(action.message);
        return;
    }
  };

  const claim = async (egg: StorefrontEgg, distance: number, handle: FoundHandle) => {
    if (claiming) return;

    const position = api.map?.position() ?? lastKnown;

    if (!position) {
      handle.setMessage("Waiting for your location. Please try again in a moment.");
      return;
    }

    claiming = true;
    handle.setBusy(true);
    handle.setMessage("");

    let outcome: ClaimOutcome;

    try {
      outcome = await api.submitClaim(egg.id, position.lat, position.lng);
    } finally {
      claiming = false;
    }

    settle(egg, distance, handle, describeOutcome(outcome));
  };

  function openFound(egg: StorefrontEgg, distance: number): void {
    ui.showFound({
      distanceMeters: distance,
      onSkip: () => {
        // skipped is the persisted "I passed on this"; dismissed is what the
        // map's findClaimableEgg actually checks. Legacy pre-dismisses skipped
        // eggs on reload (L188-191), which persisting both reproduces.
        addFlag("skipped", egg.id);
        addFlag("dismissed", egg.id);
        setRevisit({ egg, distance });
        closed();
      },
      onClaim: (handle) => {
        void claim(egg, distance, handle);
      },
    });
  }

  return {
    handleNearby(detail) {
      if (detail) lastKnown = { lat: detail.lat, lng: detail.lng };

      setRevisit(detail?.revisitable ?? null);

      // While a dialog is open the event is dropped on purpose; closed() re-arms.
      if (!detail || limitReached || ui.isOpen()) return;

      if (detail.kind === "claimable") {
        openFound(detail.egg, detail.distance);
      } else if (detail.kind === "claimed-unseen") {
        openBlocked(detail.egg, detail.distance, false);
      }
    },

    openRevisit() {
      if (!revisit || ui.isOpen() || limitReached) return;

      const { egg, distance } = revisit;

      if (claimedByMe(egg)) {
        openBlocked(egg, distance, true);
      } else if (egg.isFull) {
        openBlocked(egg, distance, false);
      } else {
        openFound(egg, distance);
      }
    },
  };
}
