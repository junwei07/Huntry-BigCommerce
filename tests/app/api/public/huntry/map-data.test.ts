import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/public/huntry/[storeHash]/map-data/route";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { MOCK_EGGS } from "@/lib/huntry/eggs/mock/mock-eggs";
import { MOCK_EVENTS } from "@/lib/huntry/events/mock/mock-events";
import { computeEventStatus } from "@/lib/huntry/events/events-api";
import { toPublicAssetUrl } from "@/lib/huntry/public-api/map-data";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

const APP_ORIGIN = "https://huntry-app.example.com";

function call(search = "", headers: Record<string, string> = {}, storeHash = "abc123") {
  return GET(new Request(`https://huntry-app.example.com/api/public/huntry/${storeHash}/map-data${search}`, { headers }), {
    params: Promise.resolve({ storeHash }),
  });
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  process.env.APP_ORIGIN = APP_ORIGIN;
});

afterEach(() => {
  delete process.env.DATA_MODE;
  delete process.env.APP_ORIGIN;
});

describe("GET map-data (MOCK mode)", () => {
  it("returns only live events", async () => {
    const body = await (await call()).json();
    const liveIds = MOCK_EVENTS.filter((event) => computeEventStatus(event.startsAt, event.endsAt) === "live").map(
      (event) => event.id,
    );

    expect(body.events.map((event: { id: number }) => event.id).sort()).toEqual(liveIds.sort());
  });

  it("narrows to one event by slug and returns nothing for an unknown slug", async () => {
    const all = (await (await call()).json()).events;

    // Hard assertion, not a skip: the fixtures must keep a live event (id 3).
    expect(all.length).toBeGreaterThan(0);

    const narrowed = (await (await call(`?event=${all[0].slug}`)).json()).events;

    expect(narrowed).toHaveLength(1);
    expect((await (await call("?event=does-not-exist")).json()).events).toEqual([]);
  });

  it("never leaks internal fields", async () => {
    const text = JSON.stringify(await (await call()).json());

    for (const forbidden of ["storeHash", "couponCode", "coupon_code", "bc_", "bcCustomerGroupId", "discount"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("sends a short shared-cache lifetime and Vary: Origin", async () => {
    const response = await call();

    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("reflects the mock dev origin and nothing else", async () => {
    const allowed = await call("", { Origin: "http://localhost:3000" });
    const denied = await call("", { Origin: "https://evil.example.com" });

    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("404s a malformed store hash without touching CORS resolution", async () => {
    const response = await call("", { Origin: "http://localhost:3000" }, "BAD/hash");

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("marks an egg full once it reaches the event's claim capacity, forced claims included", async () => {
    const liveEvent = MOCK_EVENTS.find((event) => computeEventStatus(event.startsAt, event.endsAt) === "live");

    const egg = MOCK_EGGS.find((item) => item.eventId === liveEvent?.id);

    // Fail loudly, never skip: the fixtures must keep a live event with eggs.
    if (!liveEvent || !egg) {
      throw new Error("MOCK fixtures no longer contain a live event with an egg.");
    }

    const before = MOCK_CLAIMS.length;

    for (let customer = 0; customer < liveEvent.eggClaimCapacity; customer += 1) {
      MOCK_CLAIMS.push({
        id: 9000 + customer,
        storeHash: "mock-store",
        eggId: egg.id,
        rewardId: egg.rewardId,
        eventId: egg.eventId,
        rewardNameSnapshot: "x",
        bcCustomerId: 5000 + customer,
        couponCode: "x",
        claimedAt: new Date(),
        isForced: customer === 0,
        forcedByUserId: null,
      });
    }

    try {
      const events = (await (await call()).json()).events;
      const returned = events.find((event: { id: number }) => event.id === liveEvent.id);

      expect(returned.eggs.find((item: { id: string }) => item.id === egg.id).isFull).toBe(true);
    } finally {
      MOCK_CLAIMS.length = before;
    }
  });
});

describe("toPublicAssetUrl", () => {
  it("anchors root-relative preset paths to APP_ORIGIN", () => {
    expect(toPublicAssetUrl("/huntry/markers/item/sample_1.png")).toBe(`${APP_ORIGIN}/huntry/markers/item/sample_1.png`);
  });

  it("passes http(s) URLs through unchanged", () => {
    expect(toPublicAssetUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
  });

  it("drops null, protocol-relative, javascript: and data: values", () => {
    expect(toPublicAssetUrl(null)).toBeNull();
    expect(toPublicAssetUrl("//evil.example.com/a.png")).toBeNull();
    expect(toPublicAssetUrl("javascript:alert(1)")).toBeNull();
    expect(toPublicAssetUrl("data:text/html,<script>1</script>")).toBeNull();
  });
});
