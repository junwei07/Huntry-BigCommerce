import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { logError } from "@/lib/errors/logger";
import { addMockPlayerClaim } from "@/lib/huntry/claims/mock/mock-claims";
import { MAX_PLAYERS_PER_EVENT } from "@/lib/huntry/claims/limits";
import { CreatePlayerClaimInput, CreatePlayerClaimResult } from "@/lib/huntry/claims/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";
import { computeRewardUsageLimit } from "@/lib/huntry/rewards/coupon-sync";
import { issueClaimCode } from "@/lib/huntry/rewards/claim-codes";
import { isRewardWindowOpen } from "@/lib/huntry/rewards/reward-display";
import { computeEventStatus } from "@/lib/huntry/events/events-api";
import { haversineMeters } from "@/lib/huntry/eggs/geo";

// BC-HUN-032: the atomic, capacity-validated player claim. Locking, loading
// and the write live in the repository (repository/sql/player-claim.ts);
// every decision lives in evaluateClaim below so the backends cannot drift
// (docs/MIGRATION.md §1, §7).

export const CLAIM_COOLDOWN_SECONDS = 3;
// Scripted-replay deterrent only (docs/MIGRATION.md §7) — the JWT is the
// route's access control.
export const MAX_CLAIM_SPEED_METERS_PER_SECOND = 20;

const CODE_ISSUE_TIMEOUT_MS = 10000;

// What evaluateClaim needs, loaded inside the locked transaction.
export interface ClaimContext {
  egg: { lat: number; lng: number };
  event: {
    startsAt: Date | null;
    endsAt: Date | null;
    markerRadiusMeters: number;
    maxGrabCount: number;
    eggClaimCapacity: number;
  };
  reward: {
    id: number;
    name: string;
    status: string;
    // The admin-typed code prefix (claim-codes.ts) — each claim gets its own
    // code under the reward's promotion.
    couponCode: string | null;
    bcPromotionId: string | null;
    eggCapacity: number;
    startsAt: Date | null;
    expiresAt: Date | null;
    // Claim capacity of each event the reward's eggs sit in (see
    // computeRewardUsageLimit).
    placedEggClaimCapacities: (number | null)[];
  };
  counts: { egg: number; reward: number; customerInEvent: number; playersInEvent: number };
  existingCouponCode: string | null;
  lastClaim: { lat: number | null; lng: number | null; elapsedSeconds: number } | null;
}

export type ClaimEvaluation = { ok: true } | Exclude<CreatePlayerClaimResult, { status: "created" | "code_issue_failed" | "lock_timeout" | "claim_in_progress" }>;

// Pure: no I/O, so each rule is unit-testable. Order matches the ticket.
export function evaluateClaim(
  context: ClaimContext,
  input: Pick<CreatePlayerClaimInput, "lat" | "lng">,
  now: Date = new Date(),
): ClaimEvaluation {
  const { event, reward } = context;

  if (computeEventStatus(event.startsAt, event.endsAt, now) !== "live") {
    return { status: "event_not_live" };
  }

  const rewardIsOpen = Boolean(reward.bcPromotionId) && isRewardWindowOpen(reward, now);

  if (!rewardIsOpen) {
    return { status: "reward_unavailable" };
  }

  if (context.existingCouponCode !== null) {
    return { status: "duplicate", couponCode: context.existingCouponCode };
  }

  if (haversineMeters(input, context.egg) > event.markerRadiusMeters) {
    return { status: "too_far" };
  }

  const rewardBudget = computeRewardUsageLimit(
    { eggCapacity: reward.eggCapacity },
    reward.placedEggClaimCapacities.map((eventClaimCapacity) => ({ eventClaimCapacity })),
  );

  if (context.counts.egg >= event.eggClaimCapacity || context.counts.reward >= rewardBudget) {
    return { status: "capacity_full" };
  }

  if (context.counts.customerInEvent === 0 && context.counts.playersInEvent >= MAX_PLAYERS_PER_EVENT) {
    return { status: "player_limit_reached" };
  }

  if (event.maxGrabCount > 0 && context.counts.customerInEvent >= event.maxGrabCount) {
    return { status: "limit_reached" };
  }

  const last = context.lastClaim;

  if (last) {
    if (last.elapsedSeconds < CLAIM_COOLDOWN_SECONDS) {
      return { status: "cooldown" };
    }

    if (last.lat !== null && last.lng !== null) {
      const speed = haversineMeters(input, { lat: last.lat, lng: last.lng }) / last.elapsedSeconds;

      if (speed > MAX_CLAIM_SPEED_METERS_PER_SECOND) {
        return { status: "too_fast" };
      }
    }
  }

  return { ok: true };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function createPlayerClaim(
  input: CreatePlayerClaimInput,
  storeHash: string | undefined,
): Promise<CreatePlayerClaimResult> {
  if (getDataMode() === "MOCK") {
    return addMockPlayerClaim(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a claim.");
  }

  return getHuntryRepository().claims.createPlayerClaim(resolvedStoreHash, input, {
    evaluate: (context) => evaluateClaim(context, input),
    // Issued inside the repository's lock and before it writes the claim, so the
    // row stores the real per-claim code; a failure means no claim and no code
    // shown.
    issueCode: async (reward) => {
      try {
        return await withTimeout(issueClaimCode(reward, resolvedStoreHash), CODE_ISSUE_TIMEOUT_MS);
      } catch (error) {
        logError(`createPlayerClaim: code issue for customer ${input.bcCustomerId}`, error);

        return undefined;
      }
    },
  });
}
