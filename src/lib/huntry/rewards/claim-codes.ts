import { randomInt } from "node:crypto";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { AppError } from "@/lib/errors/app-error";
import { HuntryReward } from "@/lib/huntry/rewards/types";

// BC-HUN-032: every claim gets its own single-use, unguessable coupon code
// under the reward's Promotion, replacing the shared code + Customer Group
// guard. A BigCommerce customer belongs to only one group, so a group-based
// guard silently dropped eligibility for an earlier reward on each new claim,
// and Segments need a plan tier the store may not have (live spikes,
// docs/MIGRATION.md §8). Eligibility is now possession of a code only the
// claimer is shown.
//
// Confirmed live (docs/MIGRATION.md §8): codes are 1-50 chars of
// [a-zA-Z0-9_ -], unique across the whole store (a duplicate is a 422 "already
// exist"), and a code keeps its own max_uses next to the promotion's.

const CODE_MAX_LENGTH = 50;
const SUFFIX_LENGTH = 8;
// "-" between prefix and suffix.
const MAX_PREFIX_LENGTH = CODE_MAX_LENGTH - SUFFIX_LENGTH - 1;
const FALLBACK_PREFIX = "HUNTRY";
const MAX_ATTEMPTS = 3;
// No 0/O/1/I/L — read aloud or retyped from a screenshot without mistakes.
const SUFFIX_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Admin-typed prefix reduced to what BigCommerce accepts, so a reward whose
// prefix has characters BigCommerce rejects still claims instead of 422ing.
export function sanitizeCodePrefix(prefix: string | null): string {
  const cleaned = (prefix ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, MAX_PREFIX_LENGTH);

  return cleaned || FALLBACK_PREFIX;
}

export function generateClaimCode(prefix: string | null): string {
  const suffix = Array.from({ length: SUFFIX_LENGTH }, () => SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)]).join("");

  return `${sanitizeCodePrefix(prefix)}-${suffix}`;
}

function isDuplicateCodeError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.status === 422 &&
    typeof error.cause === "string" &&
    error.cause.includes("already exist")
  );
}

interface CodeResource {
  data: { code: string };
}

// Throws on upstream failure; the caller (the claim transaction) rolls the
// claim back. A code created for a claim whose COMMIT then fails is an unused
// single-use code nobody was shown — harmless.
export async function issueClaimCode(
  reward: Pick<HuntryReward, "id" | "bcPromotionId" | "couponCode">,
  storeHash: string | undefined,
): Promise<string> {
  if (getDataMode() === "MOCK") {
    return generateClaimCode(reward.couponCode);
  }

  if (!reward.bcPromotionId) {
    throw new AppError("VALIDATION", "This reward isn't synced to BigCommerce yet. Save the reward again, then retry.");
  }

  const apiClient = await getRestApiClient(storeHash);

  for (let attempt = 1; ; attempt++) {
    const code = generateClaimCode(reward.couponCode);

    try {
      await apiClient.post<CodeResource>(`/v3/promotions/${reward.bcPromotionId}/codes`, {
        body: { code, max_uses: 1, max_uses_per_customer: 1 },
      });

      return code;
    } catch (error) {
      if (!isDuplicateCodeError(error) || attempt >= MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
}
