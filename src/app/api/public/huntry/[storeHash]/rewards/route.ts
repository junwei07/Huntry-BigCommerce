import { NextResponse } from "next/server";
import { z } from "zod";
import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getCredentialsStore } from "@/lib/credentials-store/get-credentials-store";
import { logError } from "@/lib/errors/logger";
import { listClaimsForCustomer } from "@/lib/huntry/claims/claims-api";
import { fetchBcProductLinks, fetchRewardUncached } from "@/lib/huntry/rewards/rewards-api";
import { formatRewardHeadline, isRewardWindowOpen } from "@/lib/huntry/rewards/reward-display";
import { buildCorsHeaders, buildPreflightHeaders } from "@/lib/huntry/public-api/cors";
import { isAuthorizedForStorefrontCustomer } from "@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer";

const STORE_HASH_PATTERN = /^[a-z0-9]{1,32}$/;

const bodySchema = z.object({ jwt: z.string().min(1) });

// BC-HUN-046: the storefront's "My rewards" list. Same trust model as the claim
// route (docs/MIGRATION.md §4): no session cookie, the signed customer JWT is
// the access control, and the rows are always the JWT's own customer's.
async function isKnownStore(storeHash: string): Promise<boolean> {
  return (
    STORE_HASH_PATTERN.test(storeHash) &&
    (getDataMode() !== "MULTITENANT" || Boolean(await getCredentialsStore().getStoreToken(storeHash)))
  );
}

interface RewardInfo {
  expired: boolean;
  headline: string | null;
  products: { name: string; url: string }[];
}

// The reward is gone (hard delete, no FK from claims) or no longer open.
const EXPIRED_INFO: RewardInfo = { expired: true, headline: null, products: [] };
// The lookup itself failed: say nothing rather than wrongly showing "Expired".
const UNKNOWN_INFO: RewardInfo = { expired: false, headline: null, products: [] };

// Live per-reward display state, like the plugin's coupon-post lookup
// (my-account.php L98-106): claims snapshot only the reward name, so `expired`,
// the headline and the product scope come from the reward as it is now. A
// failed lookup for one reward leaves that card without the extras (and not
// marked expired) rather than failing the whole list.
async function loadRewardInfo(storeHash: string, rewardIds: number[]): Promise<Map<number, RewardInfo>> {
  const entries = await Promise.all(
    rewardIds.map(async (rewardId): Promise<[number, RewardInfo] | null> => {
      try {
        const reward = await fetchRewardUncached(rewardId, storeHash);

        if (!reward || !isRewardWindowOpen({ status: reward.status, startsAt: reward.rewardStartsAt, expiresAt: reward.rewardExpiresAt })) {
          return [rewardId, EXPIRED_INFO];
        }

        return [
          rewardId,
          {
            expired: false,
            headline: formatRewardHeadline(reward.discountType, reward.discountValue),
            products: reward.discountScope === "specific" ? await fetchBcProductLinks(storeHash, reward.productIds) : [],
          },
        ];
      } catch (error) {
        logError(`rewards: store "${storeHash}" reward ${rewardId}`, error);

        return null;
      }
    }),
  );

  return new Map(entries.filter((entry): entry is [number, RewardInfo] => entry !== null));
}

export async function OPTIONS(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;
  const headers = (await isKnownStore(storeHash))
    ? await buildPreflightHeaders(request.headers.get("origin"), storeHash)
    : { Vary: "Origin" };

  return new NextResponse(null, { status: 204, headers });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;
  let cors: Record<string, string> = { Vary: "Origin" };
  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });

  try {
    if (!(await isKnownStore(storeHash))) {
      return respond({ error: "Not found." }, 404);
    }

    cors = await buildCorsHeaders(request.headers.get("origin"), storeHash);

    const body = bodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return respond({ error: "Invalid request." }, 400);
    }

    const auth = await isAuthorizedForStorefrontCustomer(body.data.jwt, storeHash);

    if (!auth.ok) {
      return respond({ error: "Unauthorized." }, 401);
    }

    const claims = await listClaimsForCustomer(storeHash, auth.customerId);
    const rewardInfo = await loadRewardInfo(storeHash, [...new Set(claims.map((claim) => claim.rewardId))]);

    return respond(
      {
        claims: claims.map((claim) => ({
          rewardName: claim.rewardNameSnapshot,
          couponCode: claim.couponCode,
          claimedAt: claim.claimedAt.toISOString(),
          eventId: claim.eventId,
          ...(rewardInfo.get(claim.rewardId) ?? UNKNOWN_INFO),
        })),
      },
      200,
    );
  } catch (error) {
    logError(`rewards: store "${storeHash}"`, error);

    return respond({ error: "Failed to load rewards." }, 500);
  }
}
