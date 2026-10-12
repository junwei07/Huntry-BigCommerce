import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ClaimOutcome } from "@/lib/huntry/storefront-script/claim-outcome";
import { applyCouponToCart } from "@/lib/huntry/storefront-script/claim-ui/cart";
import {
  BlockedView,
  ClaimedView,
  ClaimUi,
  createClaimController,
  FoundHandle,
  FoundView,
} from "@/lib/huntry/storefront-script/claim-ui/controller";
import { describeOutcome } from "@/lib/huntry/storefront-script/claim-ui/outcomes";
import { EggNearby } from "@/lib/huntry/storefront-script/map/egg-nearby";
import { MutableEggFlags, StorefrontEgg, StorefrontEvent } from "@/lib/huntry/storefront-script/types";

const egg = (id: string, isFull = false): StorefrontEgg => ({
  id,
  name: id,
  lat: 0,
  lng: 0,
  rewardName: `Reward ${id}`,
  isFull,
});

const EVENT = { id: 7, maxGrabCount: 0 } as StorefrontEvent;

function setup(options: { maxGrabCount?: number; outcome?: ClaimOutcome; position?: boolean } = {}) {
  const flags: MutableEggFlags = { skipped: new Set(), dismissed: new Set(), claimedDismissed: new Set(), mine: new Set() };
  const map = {
    flags,
    markEggClaimed: vi.fn((id: string) => flags.mine.add(id)),
    refreshMarker: vi.fn(),
    rearm: vi.fn(),
    position: vi.fn(() => (options.position === false ? null : { lat: 1, lng: 2 })),
    addControl: vi.fn(),
    setClaimLimitReached: vi.fn(),
    leave: vi.fn(),
  };
  const submitClaim = vi.fn(async () => options.outcome ?? ({ kind: "claimed", couponCode: "CODE1" } as ClaimOutcome));
  let open = false;
  const shown = { found: [] as FoundView[], claimed: [] as ClaimedView[], blocked: [] as BlockedView[], login: 0, limit: 0, badge: false, rewardsLink: false };
  const handle: FoundHandle & { busy: boolean[]; messages: string[] } = {
    busy: [],
    messages: [],
    setBusy(value) {
      this.busy.push(value);
    },
    setMessage(text) {
      this.messages.push(text);
    },
  };
  let onLoginBack: () => void = () => {};
  const ui: ClaimUi = {
    isOpen: () => open,
    showFound: (view) => {
      open = true;
      shown.found.push(view);
    },
    showClaimed: (view) => {
      open = true;
      shown.claimed.push(view);
    },
    showBlocked: (view) => {
      open = true;
      shown.blocked.push(view);
    },
    showLogin: (back) => {
      open = true;
      shown.login += 1;
      onLoginBack = back;
    },
    showLimit: () => {
      open = false;
      shown.limit += 1;
    },
    setBadge: (visible) => {
      shown.badge = visible;
    },
    setRewardsLink: (visible) => {
      shown.rewardsLink = visible;
    },
  };
  const controller = createClaimController(
    { config: { appOrigin: "https://app", storeHash: "abc", clientId: "c" }, submitClaim, map: map as never },
    { ...EVENT, maxGrabCount: options.maxGrabCount ?? 0 },
    ui,
  );
  const nearby = (kind: EggNearby["kind"], target: StorefrontEgg, revisitable: EggNearby["revisitable"] = null) =>
    ({ kind, egg: target, distance: 12.4, revisitable, lat: 5, lng: 6 }) as EggNearby;

  return {
    controller,
    map,
    flags,
    shown,
    handle,
    submitClaim,
    nearby,
    close: () => {
      open = false;
    },
    loginBack: () => {
      open = false;
      onLoginBack();
    },
  };
}

describe("claim controller: My rewards link (BC-HUN-046)", () => {
  it("is hidden until the shopper holds a claim, then shows without a reload", async () => {
    const t = setup();

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    expect(t.shown.rewardsLink).toBe(false);

    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.claimed).toHaveLength(1));

    expect(t.shown.rewardsLink).toBe(true);
  });

  it("shows for a shopper who already has server-side claims", () => {
    const t = setup();

    t.controller.setClaimCounts({ any: 1, thisEvent: 1 });

    expect(t.shown.rewardsLink).toBe(true);
  });

  it("hides once the claim limit is reached, where the limit overlay links instead", async () => {
    const t = setup({ maxGrabCount: 2 });

    t.controller.setClaimCounts({ any: 1, thisEvent: 1 });
    expect(t.shown.rewardsLink).toBe(true);

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.claimed).toHaveLength(1));
    t.shown.claimed[0].onKeepHunting();

    // The server count (1) plus this claim reaches the limit of 2.
    expect(t.shown.limit).toBe(1);
    expect(t.shown.rewardsLink).toBe(false);
  });

  it("is hidden on load when this event's limit is already reached", () => {
    const t = setup({ maxGrabCount: 2 });

    t.controller.setClaimCounts({ any: 2, thisEvent: 2 });

    expect(t.shown.rewardsLink).toBe(false);
  });

  it("counts only this event: claims elsewhere show the link without hitting the limit", () => {
    const t = setup({ maxGrabCount: 1 });

    t.controller.setClaimCounts({ any: 3, thisEvent: 0 });

    expect(t.shown.rewardsLink).toBe(true);
  });
});

describe("claim controller: found dialog and the skip flow", () => {
  it("opens the found dialog once for a claimable egg and ignores events while it is open", () => {
    const t = setup();
    const a = egg("a");

    t.controller.handleNearby(t.nearby("claimable", a));
    t.controller.handleNearby(t.nearby("claimable", a));

    expect(t.shown.found).toHaveLength(1);
    expect(t.shown.found[0].distanceMeters).toBeCloseTo(12.4);
  });

  it("Skip flags the egg in the map's live sets, re-arms the tracker and lights the bell", () => {
    const t = setup();
    const a = egg("a");

    t.controller.handleNearby(t.nearby("claimable", a));
    t.close();
    t.shown.found[0].onSkip();

    expect(t.flags.skipped.has("a")).toBe(true);
    expect(t.flags.dismissed.has("a")).toBe(true);
    expect(t.map.rearm).toHaveBeenCalled();
    expect(t.shown.badge).toBe(true);
  });

  it("a skipped egg is only reopened by the bell, never automatically", () => {
    const t = setup();
    const a = egg("a");

    t.controller.handleNearby(t.nearby("claimable", a));
    t.close();
    t.shown.found[0].onSkip();
    // The map now reports it as revisitable, not claimable.
    t.controller.handleNearby(t.nearby("revisitable", a, { egg: a, distance: 12 }));

    expect(t.shown.found).toHaveLength(1);
    expect(t.shown.badge).toBe(true);

    t.controller.openRevisit();

    expect(t.shown.found).toHaveLength(2);
  });

  it("clears the badge when the player leaves every radius", () => {
    const t = setup();
    const a = egg("a");

    t.controller.handleNearby(t.nearby("revisitable", a, { egg: a, distance: 12 }));
    expect(t.shown.badge).toBe(true);

    t.controller.handleNearby(null);

    expect(t.shown.badge).toBe(false);
    t.controller.openRevisit();
    expect(t.shown.found).toHaveLength(0);
  });

  it("the bell reopens the right dialog: mine, full, or the found dialog", () => {
    const mine = setup();
    const m = egg("m");

    mine.flags.mine.add("m");
    mine.controller.handleNearby(mine.nearby("revisitable", m, { egg: m, distance: 3 }));
    mine.controller.openRevisit();
    expect(mine.shown.blocked[0].title).toBe("You've already claimed this reward");

    const full = setup();
    const f = egg("f", true);

    full.controller.handleNearby(full.nearby("revisitable", f, { egg: f, distance: 3 }));
    full.controller.openRevisit();
    expect(full.shown.blocked[0].title).toBe("Someone beat you to it!");
  });

  it("dismissing the 'someone beat you to it' dialog persists claimedDismissed and moves it behind the bell", () => {
    const t = setup();
    const f = egg("f", true);

    t.controller.handleNearby(t.nearby("claimed-unseen", f));
    expect(t.shown.blocked).toHaveLength(1);

    t.close();
    t.shown.blocked[0].onDismiss();

    expect(t.flags.claimedDismissed.has("f")).toBe(true);
    expect(t.shown.badge).toBe(true);
    expect(t.map.rearm).toHaveBeenCalled();
  });
});

describe("claim controller: claiming", () => {
  it("claims with the map's latest position, marks the egg mine and shows the coupon", async () => {
    const t = setup();
    const a = egg("a");

    t.controller.handleNearby(t.nearby("claimable", a));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.claimed).toHaveLength(1));

    expect(t.submitClaim).toHaveBeenCalledWith("a", 1, 2);
    expect(t.map.markEggClaimed).toHaveBeenCalledWith("a");
    expect(t.shown.claimed[0]).toMatchObject({ couponCode: "CODE1", rewardName: "Reward a" });
    expect(t.handle.busy).toEqual([true]);
  });

  it("falls back to the position from the nearby event when the map has no fix", async () => {
    const t = setup({ position: false });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.submitClaim).toHaveBeenCalled());

    expect(t.submitClaim).toHaveBeenCalledWith("a", 5, 6);
  });

  it("does not double-submit while a claim is in flight", async () => {
    const t = setup();

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.claimed).toHaveLength(1));

    expect(t.submitClaim).toHaveBeenCalledTimes(1);
  });

  it("a duplicate claim marks the egg mine so it stops re-prompting", async () => {
    const t = setup({ outcome: { kind: "already-claimed-by-me", couponCode: "X" } });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.blocked).toHaveLength(1));

    expect(t.map.markEggClaimed).toHaveBeenCalledWith("a");
    expect(t.shown.blocked[0].title).toBe("You've already claimed this reward");
  });

  it("a full egg is treated as claimed for the session and its marker refreshed", async () => {
    const t = setup({ outcome: { kind: "full" } });
    const a = egg("a");

    t.controller.handleNearby(t.nearby("claimable", a));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.blocked).toHaveLength(1));

    expect(a.isFull).toBe(true);
    expect(t.flags.dismissed.has("a")).toBe(true);
    expect(t.map.refreshMarker).toHaveBeenCalledWith("a");
  });

  it("a retryable failure stays in the found dialog with a message and a re-enabled button", async () => {
    const t = setup({ outcome: { kind: "too-far" } });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.handle.busy).toEqual([true, false]));

    expect(t.handle.messages.at(-1)).toContain("too far");
    expect(t.shown.blocked).toHaveLength(0);
  });

  it("a guest gets the login prompt and Back returns to the found dialog", async () => {
    const t = setup({ outcome: { kind: "guest" } });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.login).toBe(1));
    t.loginBack();

    expect(t.shown.found).toHaveLength(2);
  });

  it("limit-reached shows the overlay and stops prompting for good", async () => {
    const t = setup({ outcome: { kind: "limit-reached" } });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.limit).toBe(1));
    t.close();
    t.controller.handleNearby(t.nearby("claimable", egg("b")));

    expect(t.map.setClaimLimitReached).toHaveBeenCalled();
    expect(t.shown.found).toHaveLength(1);
  });

  it("shows the limit overlay after the claimed dialog when this was the last claim", async () => {
    const t = setup({ maxGrabCount: 1 });

    t.controller.handleNearby(t.nearby("claimable", egg("a")));
    t.shown.found[0].onClaim(t.handle);
    await vi.waitFor(() => expect(t.shown.claimed).toHaveLength(1));
    t.shown.claimed[0].onKeepHunting();

    expect(t.shown.limit).toBe(1);
  });
});

describe("outcomes", () => {
  it("maps every outcome to exactly one player-facing action", () => {
    const kinds: ClaimOutcome[] = [
      { kind: "claimed", couponCode: "A" },
      { kind: "already-claimed-by-me", couponCode: "A" },
      { kind: "guest" },
      { kind: "too-far" },
      { kind: "full" },
      { kind: "limit-reached" },
      { kind: "not-live" },
      { kind: "unavailable" },
      { kind: "rate-limited", retryAfterSeconds: 30 },
      { kind: "slow-down" },
      { kind: "retry-later" },
      { kind: "not-found" },
      { kind: "error" },
    ];

    for (const outcome of kinds) {
      expect(describeOutcome(outcome).type).toBeTruthy();
    }

    expect(describeOutcome({ kind: "rate-limited", retryAfterSeconds: 30 })).toEqual({
      type: "inline",
      message: "Too many attempts. Try again in 30 seconds.",
    });
  });
});

describe("applyCouponToCart", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it("posts the code to the shopper's own cart on the storefront origin", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);

      return url.endsWith("/coupons") ? json({ id: "cart-1" }) : json([{ id: "cart-1" }]);
    });

    expect(await applyCouponToCart("HUNT10", fetchImpl)).toEqual({ kind: "applied" });
    expect(calls.map(([url]) => url)).toEqual(["/api/storefront/carts", "/api/storefront/carts/cart-1/coupons"]);
    expect(calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"couponCode":"HUNT10"}' });
  });

  it("reports no cart, a rejected code, and network failure", async () => {
    expect(await applyCouponToCart("X", async () => json([]))).toEqual({ kind: "no-cart" });
    expect(
      await applyCouponToCart("X", async (url) =>
        url.endsWith("/coupons") ? json({ title: "Nope", detail: "Coupon is not valid" }, 422) : json([{ id: "c" }]),
      ),
    ).toEqual({ kind: "rejected", message: "Coupon is not valid" });
    expect(await applyCouponToCart("X", async () => Promise.reject(new Error("offline")))).toEqual({ kind: "error" });
    expect(await applyCouponToCart("X", async () => json({}, 500))).toEqual({ kind: "error" });
  });
});

describe("claim-ui source rules", () => {
  const dir = path.join(process.cwd(), "src/lib/huntry/storefront-script/claim-ui");
  const sources = readdirSync(dir).map((name) => [name, readFileSync(path.join(dir, name), "utf8")] as const);

  it("never writes API text with innerHTML or insertAdjacentHTML", () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    }
  });

  it("never calls our own backend for the cart", () => {
    const cart = sources.find(([name]) => name === "cart.ts")?.[1] ?? "";

    expect(cart).not.toMatch(/appOrigin|api\/public\/huntry/);
  });
});

describe("storefront views source rules", () => {
  it("rewards and nav views never use innerHTML", () => {
    for (const name of ["rewards-view.ts", "page-nav.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "src/lib/huntry/storefront-script", name), "utf8");

      expect(source, name).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    }
  });
});
