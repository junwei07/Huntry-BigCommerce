import type { ClaimOutcome } from "../claim-outcome";

// What the player sees for each claims-route outcome. English strings are the
// legacy plugin's defaults (huntry-frontend-map.js showClaimedDialog,
// showClaimBlockedDialog, submitClaim). Pure, so the mapping is unit-tested.
export const STRINGS = {
  foundTitle: "You found something!",
  foundMessage: (meters: number) => `There's an item about ${meters}m away. Claim it before someone else does!`,
  claimedTitle: "You found a reward!",
  newReward: "New Reward",
  useCode: "Use code:",
  atCheckout: "at checkout.",
  keepHunting: "Keep Hunting",
  skip: "Skip",
  claim: "Claim",
  claiming: "Claiming",
  applyToCart: "Apply to my cart",
  applying: "Applying",
  viewCart: "View cart",
  logInToClaim: "Log in to claim this reward.",
  logIn: "Log In",
  back: "Back",
  alreadyClaimedTitle: "Someone beat you to it!",
  alreadyClaimed: "This treasure has been fully claimed. Keep hunting — there are more waiting to be found!",
  claimedByMeTitle: "You've already claimed this reward",
  claimedByMe: "Keep hunting!",
  limitTitle: "You're Out Of Claims!",
  limitMessage: "You've reached your claim limit for this hunt.  Use your rewards before they expire!",
  backToHunts: "Back to all hunts",
  genericError: "Couldn't claim this right now. Please try again.",
  skippedItems: "Skipped items",
  myRewards: "My rewards",
  viewRewards: "View Rewards",
  savedToRewards: "Saved to My Rewards. Find it any time from the View Rewards button.",
} as const;

export type OutcomeAction =
  | { type: "claimed"; couponCode: string }
  | { type: "login" }
  | { type: "limit" }
  // The egg can't be claimed any more; show a dialog and stop offering it.
  | { type: "blocked"; reason: "full" | "mine" | "not-live" | "unavailable"; icon: string; title: string; message: string }
  // A failure worth retrying: message under the Claim button, button re-enabled.
  | { type: "inline"; message: string };

export function describeOutcome(outcome: ClaimOutcome): OutcomeAction {
  switch (outcome.kind) {
    case "claimed":
      return { type: "claimed", couponCode: outcome.couponCode };
    case "guest":
      return { type: "login" };
    case "limit-reached":
      return { type: "limit" };
    case "full":
      return {
        type: "blocked",
        reason: "full",
        icon: "😅",
        title: STRINGS.alreadyClaimedTitle,
        message: STRINGS.alreadyClaimed,
      };
    case "already-claimed-by-me":
      return {
        type: "blocked",
        reason: "mine",
        icon: "✅",
        title: STRINGS.claimedByMeTitle,
        message: STRINGS.claimedByMe,
      };
    case "not-live":
      return {
        type: "blocked",
        reason: "not-live",
        icon: "⏰",
        title: "This hunt isn't active",
        message: "This hunt isn't live right now, so nothing can be claimed.",
      };
    case "unavailable":
      return {
        type: "blocked",
        reason: "unavailable",
        icon: "😕",
        title: "Reward unavailable",
        message: "This reward is no longer available. Keep hunting — there are more waiting to be found!",
      };
    case "too-far":
      return { type: "inline", message: "You're too far from this item. Move closer and try again." };
    case "rate-limited":
      return { type: "inline", message: `Too many attempts. Try again in ${outcome.retryAfterSeconds} seconds.` };
    case "slow-down":
      return { type: "inline", message: "Please wait a moment before trying again." };
    case "retry-later":
      return { type: "inline", message: "We couldn't reach the reward service. Please try again in a moment." };
    case "not-found":
    case "error":
      return { type: "inline", message: STRINGS.genericError };
  }
}
