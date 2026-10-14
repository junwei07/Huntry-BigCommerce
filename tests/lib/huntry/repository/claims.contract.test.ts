import { describe, expect, it } from "vitest";
import { evaluateClaim } from "@/lib/huntry/claims/player-claim";
import type { CreatePlayerClaimResult } from "@/lib/huntry/claims/types";
import { DEFAULT_EVENT_THEME } from "@/lib/huntry/events/types";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { claimDocData, claimRef, customerRef, eggCounterRef, rewardCounterRef } from "@/lib/huntry/repository/firestore/claim-docs";
import type { PlayerClaimHooks } from "@/lib/huntry/repository/types";
import { implementations, newStoreHash, TestRepositories, useFirestore, useRepositoryHarness } from "./harness";

useRepositoryHarness();

interface World {
  storeHash: string;
  eventId: number;
  rewardId: number;
  eggIds: string[];
}

// A live event, a synced reward and `eggCount` eggs at the origin.
async function seedWorld(repos: TestRepositories, eggCount = 1, eggClaimCapacity = 3): Promise<World> {
  const storeHash = newStoreHash();
  const event = await repos.events.create(
    storeHash,
    {
      name: "Hunt",
      description: "",
      startsAt: new Date(Date.now() - 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
      headerBannerUrl: null,
      markerRadiusMeters: 50,
      maxGrabCount: 0,
      eggClaimCapacity,
      theme: DEFAULT_EVENT_THEME,
      isFeatured: false,
      featuredOrder: null,
    },
    `hunt-${Math.random().toString(36).slice(2)}`,
  );
  const reward = await repos.rewards.create(storeHash, {
    name: "Reward",
    description: "",
    sponsorId: null,
    eggCapacity: 5,
    rewardStartsAt: null,
    rewardExpiresAt: null,
    discountType: "percent",
    discountValue: 10,
    discountScope: "all",
    productIds: [],
    couponCode: "PREFIX",
  });

  await repos.rewards.updateCouponFields(storeHash, reward.id, { bcPromotionId: "1", bcCouponCodeId: null, bcCustomerGroupId: null });

  const eggs = await repos.eggs.createMany(
    storeHash,
    Array.from({ length: eggCount }, (_, index) => ({ eventId: event.id, rewardId: reward.id, name: `egg ${index}`, lat: 0, lng: 0 })),
  );

  return { storeHash, eventId: event.id, rewardId: reward.id, eggIds: eggs.map((egg) => egg.id) };
}

let codeCounter = 0;

function hooksFor(input: { lat: number; lng: number }, issue?: PlayerClaimHooks["issueCode"]): PlayerClaimHooks {
  return {
    evaluate: (context) => evaluateClaim(context, input),
    issueCode: issue ?? (async () => `code-${Date.now()}-${codeCounter++}`),
  };
}

async function claim(
  repos: TestRepositories,
  world: World,
  customerId: number,
  eggIndex = 0,
  issue?: PlayerClaimHooks["issueCode"],
): Promise<CreatePlayerClaimResult> {
  const input = { eggId: world.eggIds[eggIndex], bcCustomerId: customerId, lat: 0, lng: 0 };

  // A real client retries a 503 (lock_timeout); do the same so contention is not a failure.
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await repos.claims.createPlayerClaim(world.storeHash, input, hooksFor(input, issue));

    if (result.status !== "lock_timeout") {
      return result;
    }
  }

  throw new Error("still lock_timeout after retries");
}

describe.each(implementations)("claims repository ($name)", ({ create }) => {
  it("creates a claim, then returns the same code as a duplicate", async () => {
    const repos = await create();
    const world = await seedWorld(repos);
    const first = await claim(repos, world, 1, 0, async () => "abc-code-1");

    expect(first).toMatchObject({ status: "created", claim: { couponCode: "abc-code-1", bcCustomerId: 1, isForced: false, redemptionStatus: "unredeemed" } });
    expect(await claim(repos, world, 1)).toEqual({ status: "duplicate", couponCode: "abc-code-1" });
    expect(await repos.claims.hasClaimedEgg(world.storeHash, world.eggIds[0], 1)).toBe(true);
    expect(await repos.claims.hasClaimedEgg(world.storeHash, world.eggIds[0], 2)).toBe(false);
    expect((await repos.claims.listClaimsForCustomer(world.storeHash, 1)).map((c) => c.couponCode)).toEqual(["abc-code-1"]);
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 1, forced: 0 }]]));
  });

  it("refuses a claim on an unknown egg", async () => {
    const repos = await create();
    const world = await seedWorld(repos);

    expect(await repos.claims.createPlayerClaim(world.storeHash, { eggId: "no-such-egg", bcCustomerId: 1, lat: 0, lng: 0 }, hooksFor({ lat: 0, lng: 0 }))).toEqual({
      status: "egg_not_found",
    });
  });

  it("stops at the egg's claim capacity", async () => {
    const repos = await create();
    const world = await seedWorld(repos, 1, 1);

    expect((await claim(repos, world, 1)).status).toBe("created");
    expect((await claim(repos, world, 2)).status).toBe("capacity_full");
    expect(await repos.claims.listFullEggIds(world.storeHash, world.eventId, 1)).toEqual(new Set([world.eggIds[0]]));
    expect(await repos.claims.listFullEggIds(world.storeHash, world.eventId, 2)).toEqual(new Set());
  });

  it("applies the cooldown across eggs for one customer", async () => {
    const repos = await create();
    const world = await seedWorld(repos, 2);

    expect((await claim(repos, world, 1, 0)).status).toBe("created");
    expect((await claim(repos, world, 1, 1)).status).toBe("cooldown");
  });

  it("rolls back fully when the code cannot be issued, leaving no cooldown behind", async () => {
    const repos = await create();
    const world = await seedWorld(repos, 2);

    expect((await claim(repos, world, 1, 0, async () => undefined)).status).toBe("code_issue_failed");
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map());
    expect(await repos.claims.hasClaimedEgg(world.storeHash, world.eggIds[0], 1)).toBe(false);
    // The failed attempt must not have left a cooldown or a position behind.
    expect((await claim(repos, world, 1, 1)).status).toBe("created");
  });

  it("records forced claims that count toward capacity but never rank", async () => {
    const repos = await create();
    const world = await seedWorld(repos, 1, 2);
    const input = {
      eggId: world.eggIds[0],
      rewardId: world.rewardId,
      eventId: world.eventId,
      rewardNameSnapshot: "Reward",
      bcCustomerId: 5,
      couponCode: "FORCED-1",
      forcedByUserId: 9,
    };

    expect(await repos.claims.createForcedClaim(world.storeHash, input)).toMatchObject({
      status: "created",
      claim: { isForced: true, forcedByUserId: 9, couponCode: "FORCED-1" },
    });
    expect(await repos.claims.createForcedClaim(world.storeHash, input)).toEqual({ status: "duplicate" });
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 1, forced: 1 }]]));
    expect(await repos.claims.getLeaderboard(world.storeHash, world.eventId, 10)).toEqual([]);
    expect((await repos.claims.listRecentClaims(world.storeHash, world.eventId, 10)).map((c) => c.couponCode)).toEqual(["FORCED-1"]);
    // Forced claims are never rate limited.
    expect(await repos.claims.listRecentClaimAges(world.storeHash, 5, 60, 5)).toEqual([]);
    // But they use up capacity: one player claim fits, the next does not.
    expect((await claim(repos, world, 6)).status).toBe("created");
    expect((await claim(repos, world, 7)).status).toBe("capacity_full");
  });

  it("ranks players, lists activity newest first and reports recent claim ages", async () => {
    const repos = await create();
    const world = await seedWorld(repos, 1, 3);

    await claim(repos, world, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await claim(repos, world, 2);

    expect((await repos.claims.getLeaderboard(world.storeHash, world.eventId, 10)).map((row) => [row.bcCustomerId, row.claimCount])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect((await repos.claims.getLeaderboard(world.storeHash, world.eventId, 1))).toHaveLength(1);
    expect((await repos.claims.listRecentClaims(world.storeHash, world.eventId, 10)).map((c) => c.bcCustomerId)).toEqual([2, 1]);
    expect((await repos.claims.listRecentClaims(world.storeHash, world.eventId, 1))).toHaveLength(1);

    const ages = await repos.claims.listRecentClaimAges(world.storeHash, 1, 60, 5);

    expect(ages).toHaveLength(1);
    expect(ages[0]).toBeGreaterThanOrEqual(0);
    expect(ages[0]).toBeLessThan(60);
  });

  it("finds claims by case-insensitive code and marks each redemption once", async () => {
    const repos = await create();
    const world = await seedWorld(repos);

    await claim(repos, world, 1, 0, async () => "mixed-Case-77");

    const found = await repos.claims.findClaimsByNormalizedCouponCodes(world.storeHash, ["MIXED-CASE-77", "NOPE"]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ eventId: world.eventId, bcCustomerId: 1, couponCode: "mixed-Case-77", redemptionStatus: "unredeemed" });
    expect(await repos.claims.findClaimsByNormalizedCouponCodes(newStoreHash(), ["MIXED-CASE-77"])).toEqual([]);

    expect(await repos.claims.markRedemptions(world.storeHash, 4001, [{ claimId: found[0].id, status: "redeemed" }])).toBe(1);
    expect(await repos.claims.markRedemptions(world.storeHash, 4002, [{ claimId: found[0].id, status: "flagged_unauthorized_use" }])).toBe(0);
    expect((await repos.claims.findClaimsByNormalizedCouponCodes(world.storeHash, ["MIXED-CASE-77"]))[0].redemptionStatus).toBe("redeemed");
  });
});

// Firestore-specific behaviour: the reserve/finalize flow, pending reservations and contention.
describe.skipIf(!useFirestore)("claims repository (firestore reservations)", () => {
  async function setup(eggCount = 1, eggClaimCapacity = 3) {
    const repos = await implementations.find((impl) => impl.name === "firestore")!.create();
    const world = await seedWorld(repos, eggCount, eggClaimCapacity);

    return { repos, world, db: getFirestoreDb() };
  }

  async function writePending(
    db: ReturnType<typeof getFirestoreDb>,
    world: World,
    customerId: number,
    ageMs: number,
    reservationId = "reservation-1",
  ) {
    const reservedAt = new Date(Date.now() - ageMs);

    await claimRef(db, world.storeHash, world.eggIds[0], customerId).set({
      ...claimDocData({
        storeHash: world.storeHash,
        eggId: world.eggIds[0],
        rewardId: world.rewardId,
        eventId: world.eventId,
        rewardNameSnapshot: "Reward",
        bcCustomerId: customerId,
        couponCode: null,
        claimedAt: reservedAt,
        isForced: false,
        forcedByUserId: null,
        status: "pending",
      }),
      reservationId,
      reservedAt,
      previousCustomer: { lastClaimAt: null, lastLat: null, lastLng: null },
    });
    await eggCounterRef(db, world.storeHash, world.eggIds[0]).set({ eventId: world.eventId, count: 1 }, { merge: true });
    await rewardCounterRef(db, world.storeHash, world.rewardId).set({ count: 1 }, { merge: true });
    await customerRef(db, world.storeHash, customerId).set({ lastClaimAt: reservedAt, lastLat: 0, lastLng: 0, eventCounts: { [String(world.eventId)]: 1 } });
  }

  it("never shows a pending reservation to any reader, but it still counts toward capacity", async () => {
    const { repos, world, db } = await setup(1, 1);

    await writePending(db, world, 1, 1_000);

    expect(await repos.claims.listClaimsForCustomer(world.storeHash, 1)).toEqual([]);
    expect(await repos.claims.listRecentClaims(world.storeHash, world.eventId, 10)).toEqual([]);
    expect(await repos.claims.getLeaderboard(world.storeHash, world.eventId, 10)).toEqual([]);
    expect(await repos.claims.listRecentClaimAges(world.storeHash, 1, 60, 5)).toEqual([]);
    expect(await repos.claims.findClaimsByNormalizedCouponCodes(world.storeHash, ["ANYTHING"])).toEqual([]);
    expect(await repos.claims.markRedemptions(world.storeHash, 1, [{ claimId: `${world.eggIds[0]}_1`, status: "redeemed" }])).toBe(0);
    // Reserved capacity is capacity, and the holder still "owns" the egg for rate limiting.
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 1, forced: 0 }]]));
    expect(await repos.claims.hasClaimedEgg(world.storeHash, world.eggIds[0], 1)).toBe(true);
  });

  it("answers claim_in_progress while the same customer's reservation is fresh", async () => {
    const { repos, world, db } = await setup();

    await writePending(db, world, 1, 1_000);

    expect((await claim(repos, world, 1)).status).toBe("claim_in_progress");
  });

  it("takes over this customer's expired reservation without double counting", async () => {
    const { repos, world, db } = await setup(1, 1);

    await writePending(db, world, 1, 5 * 60_000);

    expect((await claim(repos, world, 1)).status).toBe("created");
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 1, forced: 0 }]]));
    expect((await rewardCounterRef(db, world.storeHash, world.rewardId).get()).get("count")).toBe(1);
  });

  it("frees capacity held by another customer's expired reservation", async () => {
    const { repos, world, db } = await setup(1, 1);

    await writePending(db, world, 1, 5 * 60_000);

    expect((await claim(repos, world, 2)).status).toBe("created");
    expect(await repos.claims.hasClaimedEgg(world.storeHash, world.eggIds[0], 1)).toBe(false);
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 1, forced: 0 }]]));
    // The expired holder's cooldown/position state is released too.
    expect((await customerRef(db, world.storeHash, 1).get()).get("eventCounts")).toEqual({ [String(world.eventId)]: 0 });
  });

  it("does not free capacity held by another customer's fresh reservation", async () => {
    const { repos, world, db } = await setup(1, 1);

    await writePending(db, world, 1, 1_000);

    expect((await claim(repos, world, 2)).status).toBe("capacity_full");
  });

  it("reports code_issue_failed when the reservation disappears while the code is being issued", async () => {
    const { repos, world, db } = await setup();

    const result = await claim(repos, world, 1, 0, async () => {
      await claimRef(db, world.storeHash, world.eggIds[0], 1).delete();

      return "orphan-code";
    });

    expect(result.status).toBe("code_issue_failed");
    expect(await repos.claims.listClaimsForCustomer(world.storeHash, 1)).toEqual([]);
  });

  it("lets exactly K of N concurrent customers claim an egg of capacity K", async () => {
    const { repos, world } = await setup(1, 2);
    const results = await Promise.all([1, 2, 3, 4, 5].map((customerId) => claim(repos, world, customerId)));

    expect(results.filter((result) => result.status === "created")).toHaveLength(2);
    expect(results.filter((result) => result.status === "capacity_full")).toHaveLength(3);
    expect(await repos.claims.getEggClaimCounts(world.storeHash, world.eventId)).toEqual(new Map([[world.eggIds[0], { count: 2, forced: 0 }]]));
  }, 60_000);

  it("holds the cooldown when one customer claims two eggs at once", async () => {
    const { repos, world } = await setup(2);
    const results = await Promise.all([claim(repos, world, 1, 0), claim(repos, world, 1, 1)]);
    const statuses = results.map((result) => result.status).sort();

    expect(statuses).toEqual(["cooldown", "created"]);
  }, 60_000);
});
