import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_THEME, CreateEventInput } from "@/lib/huntry/events/types";
import { isUniqueSlugConstraintError } from "@/lib/huntry/events/events-api";
import { isUniqueCouponCodeConstraintError } from "@/lib/huntry/rewards/rewards-api";
import type { CreateRewardInput } from "@/lib/huntry/rewards/types";
import type { CreateSponsorInput } from "@/lib/huntry/sponsors/types";
import { implementations, newStoreHash, useFirestore, useRepositoryHarness } from "./harness";

useRepositoryHarness();

const sponsorInput = (name: string): CreateSponsorInput => ({
  name,
  logoUrl: "/logo.png",
  instagramUrl: null,
  facebookUrl: null,
  websiteUrl: "https://example.com",
  location: null,
});

const eventInput = (name: string, startsAt: Date | null = null): CreateEventInput => ({
  name,
  description: "desc",
  startsAt,
  endsAt: startsAt ? new Date(startsAt.getTime() + 3_600_000) : null,
  headerBannerUrl: null,
  markerRadiusMeters: 50,
  maxGrabCount: 5,
  eggClaimCapacity: 3,
  theme: DEFAULT_EVENT_THEME,
  isFeatured: false,
  featuredOrder: null,
});

const rewardInput = (name: string, couponCode: string, overrides: Partial<CreateRewardInput> = {}): CreateRewardInput => ({
  name,
  description: "desc",
  sponsorId: null,
  eggCapacity: 5,
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [],
  couponCode,
  ...overrides,
});

describe.each(implementations)("catalog repositories ($name)", ({ name: implementation, create }) => {
  describe("sponsors", () => {
    it("creates, reads, updates and lists by name", async () => {
      const { sponsors } = await create();
      const storeHash = newStoreHash();
      const b = await sponsors.create(storeHash, sponsorInput("Bravo"));
      const a = await sponsors.create(storeHash, sponsorInput("Alpha"));

      expect(await sponsors.get(storeHash, a.id)).toMatchObject({ name: "Alpha", storeHash, websiteUrl: "https://example.com" });
      expect((await sponsors.list(storeHash, "ASC")).map((s) => s.name)).toEqual(["Alpha", "Bravo"]);
      expect((await sponsors.list(storeHash, "DESC")).map((s) => s.name)).toEqual(["Bravo", "Alpha"]);

      const updated = await sponsors.update(storeHash, b.id, { ...sponsorInput("Bravo 2"), location: "Paris" });

      expect(updated).toMatchObject({ id: b.id, name: "Bravo 2", location: "Paris" });
      expect(await sponsors.update(storeHash, 987_654, sponsorInput("x"))).toBeUndefined();
    });

    it("keeps stores isolated and deletes once", async () => {
      const { sponsors } = await create();
      const mine = newStoreHash();
      const theirs = newStoreHash();
      const sponsor = await sponsors.create(mine, sponsorInput("Mine"));

      expect(await sponsors.get(theirs, sponsor.id)).toBeUndefined();
      expect(await sponsors.delete(theirs, sponsor.id)).toBe(false);
      expect(await sponsors.delete(mine, sponsor.id)).toBe(true);
      expect(await sponsors.delete(mine, sponsor.id)).toBe(false);
    });

    it("detaches a deleted sponsor from its rewards", async () => {
      const { sponsors, rewards } = await create();
      const storeHash = newStoreHash();
      const sponsor = await sponsors.create(storeHash, sponsorInput("S"));
      const reward = await rewards.create(storeHash, rewardInput("R", "DETACH1", { sponsorId: sponsor.id }));

      await sponsors.delete(storeHash, sponsor.id);

      expect((await rewards.get(storeHash, reward.id))?.sponsorId).toBeNull();
    });
  });

  describe("events", () => {
    it("creates with the given slug, reads back, counts and updates without changing the slug", async () => {
      const { events } = await create();
      const storeHash = newStoreHash();
      const created = await events.create(storeHash, eventInput("Spring Hunt"), "spring-hunt");

      expect(created).toMatchObject({ storeHash, name: "Spring Hunt", slug: "spring-hunt", markerRadiusMeters: 50 });
      expect(created.theme).toEqual(DEFAULT_EVENT_THEME);
      expect(await events.count(storeHash)).toBe(1);

      const updated = await events.update(storeHash, created.id, { ...eventInput("Renamed"), isFeatured: true, featuredOrder: 2 });

      expect(updated).toMatchObject({ id: created.id, name: "Renamed", slug: "spring-hunt", isFeatured: true, featuredOrder: 2 });
      expect((await events.get(storeHash, created.id))?.createdAt.getTime()).toBe(created.createdAt.getTime());
      expect(await events.update(storeHash, 987_654, eventInput("x"))).toBeUndefined();
    });

    it("throws an error the slug helper recognises when the slug is taken", async () => {
      const { events } = await create();
      const storeHash = newStoreHash();

      await events.create(storeHash, eventInput("One"), "same-slug");

      const error = await events.create(storeHash, eventInput("Two"), "same-slug").catch((caught: unknown) => caught);

      expect(isUniqueSlugConstraintError(error)).toBe(true);
      // The same slug in another store is fine.
      await expect(events.create(newStoreHash(), eventInput("Three"), "same-slug")).resolves.toMatchObject({ slug: "same-slug" });
    });

    it("sorts by name or by start time with unscheduled events last", async () => {
      const { events } = await create();
      const storeHash = newStoreHash();

      await events.create(storeHash, eventInput("Zulu", new Date("2030-01-01T00:00:00Z")), "zulu");
      await events.create(storeHash, eventInput("Mike"), "mike");
      await events.create(storeHash, eventInput("Alpha", new Date("2031-01-01T00:00:00Z")), "alpha");

      expect((await events.list(storeHash, "name")).map((e) => e.name)).toEqual(["Alpha", "Mike", "Zulu"]);
      expect((await events.list(storeHash, "time")).map((e) => e.name)).toEqual(["Zulu", "Alpha", "Mike"]);
    });

    it("deletes once and frees the slug", async () => {
      const { events } = await create();
      const storeHash = newStoreHash();
      const event = await events.create(storeHash, eventInput("Gone"), "gone");

      expect(await events.delete(storeHash, event.id)).toBe(true);
      expect(await events.delete(storeHash, event.id)).toBe(false);
      await expect(events.create(storeHash, eventInput("Again"), "gone")).resolves.toMatchObject({ slug: "gone" });
    });
  });

  describe("rewards", () => {
    it("creates, stores specific-scope product ids only, updates and lists", async () => {
      const { rewards } = await create();
      const storeHash = newStoreHash();
      const specific = await rewards.create(
        storeHash,
        rewardInput("Specific", "SPEC1", { discountScope: "specific", productIds: [11, 22] }),
      );
      const all = await rewards.create(storeHash, rewardInput("All", "ALL1", { productIds: [99] }));

      expect(specific.productIds.sort()).toEqual([11, 22]);
      expect(all.productIds).toEqual([]);
      expect(all).toMatchObject({ status: "active", bcPromotionId: null, discountValue: 10 });
      expect((await rewards.list(storeHash, "name")).map((r) => r.name)).toEqual(["All", "Specific"]);

      const updated = await rewards.update(
        storeHash,
        specific.id,
        rewardInput("Specific 2", "SPEC1", { discountScope: "specific", productIds: [33] }),
      );

      expect(updated).toMatchObject({ id: specific.id, name: "Specific 2", productIds: [33] });
      expect(await rewards.update(storeHash, 987_654, rewardInput("x", "NOPE"))).toBeUndefined();
    });

    it("rejects a duplicate coupon code with an error the coupon helper recognises", async () => {
      const { rewards } = await create();
      const storeHash = newStoreHash();
      const first = await rewards.create(storeHash, rewardInput("First", "DUPE1"));

      expect(await rewards.isCouponCodeTaken(storeHash, "DUPE1")).toBe(true);
      expect(await rewards.isCouponCodeTaken(storeHash, "DUPE1", first.id)).toBe(false);
      expect(await rewards.isCouponCodeTaken(storeHash, "FREE1")).toBe(false);

      const error = await rewards.create(storeHash, rewardInput("Second", "DUPE1")).catch((caught: unknown) => caught);

      expect(isUniqueCouponCodeConstraintError(error)).toBe(true);
    });

    it("moves a coupon code on update and frees it on delete", async () => {
      const { rewards } = await create();
      const storeHash = newStoreHash();
      const reward = await rewards.create(storeHash, rewardInput("Mover", "OLD1"));

      await rewards.update(storeHash, reward.id, rewardInput("Mover", "NEW1"));

      expect(await rewards.isCouponCodeTaken(storeHash, "OLD1")).toBe(false);
      expect(await rewards.isCouponCodeTaken(storeHash, "NEW1")).toBe(true);
      expect(await rewards.delete(storeHash, reward.id)).toBe(true);
      expect(await rewards.delete(storeHash, reward.id)).toBe(false);
      expect(await rewards.isCouponCodeTaken(storeHash, "NEW1")).toBe(false);
    });

    it("writes only the BigCommerce id fields from updateCouponFields", async () => {
      const { rewards } = await create();
      const storeHash = newStoreHash();
      const reward = await rewards.create(storeHash, rewardInput("Synced", "SYNC1"));

      await rewards.updateCouponFields(storeHash, reward.id, { bcPromotionId: "77", bcCouponCodeId: null, bcCustomerGroupId: null });

      expect(await rewards.get(storeHash, reward.id)).toMatchObject({ name: "Synced", couponCode: "SYNC1", bcPromotionId: "77" });
    });

    it.skipIf(implementation !== "firestore")("treats coupon codes case-insensitively (stricter than SQL, on purpose)", async () => {
      const { rewards } = await create();
      const storeHash = newStoreHash();

      await rewards.create(storeHash, rewardInput("Upper", "CaseCode"));

      expect(await rewards.isCouponCodeTaken(storeHash, "  casecode ")).toBe(true);
      await expect(rewards.create(storeHash, rewardInput("Lower", "casecode"))).rejects.toThrow("UNIQUE constraint failed");
    });
  });

  describe("eggs", () => {
    it("places, lists, updates and deletes eggs", async () => {
      const { eggs, events, rewards } = await create();
      const storeHash = newStoreHash();
      const event = await events.create(storeHash, eventInput("E"), "e");
      const reward = await rewards.create(storeHash, rewardInput("R", "EGGR1"));
      const other = await rewards.create(storeHash, rewardInput("R2", "EGGR2"));
      const placed = await eggs.createMany(storeHash, [
        { eventId: event.id, rewardId: reward.id, name: "one", lat: 1.5, lng: 2.5 },
        { eventId: event.id, rewardId: reward.id, name: "two", lat: 3.5, lng: 4.5 },
        { eventId: event.id, rewardId: other.id, name: "three", lat: 5.5, lng: 6.5 },
      ]);

      expect(placed).toHaveLength(3);
      expect((await eggs.listByEvent(storeHash, event.id)).map((egg) => egg.name).sort()).toEqual(["one", "three", "two"]);
      expect(await eggs.countsByReward(storeHash)).toEqual(new Map([[reward.id, 2], [other.id, 1]]));
      expect((await eggs.listRewardIdsForEvent(storeHash, event.id)).sort()).toEqual([reward.id, other.id].sort());
      expect(await eggs.listPlacedCapacities(storeHash, reward.id)).toEqual([{ eventClaimCapacity: 3 }, { eventClaimCapacity: 3 }]);

      // The SQL batch insert reads its rows back unordered, so pick by name.
      const egg = placed.find((candidate) => candidate.name === "one")!;

      expect(await eggs.get(storeHash, egg.id)).toMatchObject({ name: "one", lat: 1.5, lng: 2.5 });
      expect(await eggs.update(storeHash, egg.id, { rewardId: other.id, name: "uno", lat: 9, lng: 8 })).toMatchObject({
        id: egg.id,
        eventId: event.id,
        rewardId: other.id,
        name: "uno",
        lat: 9,
        lng: 8,
      });
      expect(await eggs.update(storeHash, "00000000-0000-4000-8000-000000000000", { rewardId: 1, name: "x", lat: 0, lng: 0 })).toBeUndefined();
      expect(await eggs.delete(storeHash, egg.id)).toBe(true);
      expect(await eggs.delete(storeHash, egg.id)).toBe(false);
    });

    it("cascades egg deletion from an event and from a reward", async () => {
        const { eggs, events, rewards } = await create();
        const storeHash = newStoreHash();
        const event = await events.create(storeHash, eventInput("Cascade"), "cascade");
        const reward = await rewards.create(storeHash, rewardInput("R", "CASC1"));
        const keep = await rewards.create(storeHash, rewardInput("Keep", "CASC2"));

        await eggs.createMany(storeHash, [
          { eventId: event.id, rewardId: reward.id, name: "a", lat: 0, lng: 0 },
          { eventId: event.id, rewardId: keep.id, name: "b", lat: 0, lng: 0 },
        ]);
        await rewards.delete(storeHash, reward.id);

        expect((await eggs.listByEvent(storeHash, event.id)).map((egg) => egg.name)).toEqual(["b"]);

        await events.delete(storeHash, event.id);

        expect(await eggs.listByEvent(storeHash, event.id)).toEqual([]);
    });
  });
});

describe.skipIf(!useFirestore)("catalog repositories (firestore, concurrency)", () => {
  it("never hands the same numeric id to two concurrent creates", async () => {
    const { sponsors } = await implementations.find((impl) => impl.name === "firestore")!.create();
    const storeHash = newStoreHash();
    const created = await Promise.all(Array.from({ length: 5 }, (_, index) => sponsors.create(storeHash, sponsorInput(`S${index}`))));

    expect(new Set(created.map((sponsor) => sponsor.id)).size).toBe(5);
  }, 30_000);

  it("lets exactly one of several concurrent creates win a slug", async () => {
    const { events } = await implementations.find((impl) => impl.name === "firestore")!.create();
    const storeHash = newStoreHash();
    const results = await Promise.allSettled(Array.from({ length: 4 }, (_, index) => events.create(storeHash, eventInput(`E${index}`), "race")));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(3);
  }, 30_000);
});
