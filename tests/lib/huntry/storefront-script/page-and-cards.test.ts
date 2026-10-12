import { describe, expect, it } from "vitest";
import { buildCards, endsCountdown, formatDateRange } from "@/lib/huntry/storefront-script/cards";
import { safeColor } from "@/lib/huntry/storefront-script/map/chrome";
import { pageNavItems } from "@/lib/huntry/storefront-script/page-nav";
import { decideMode, readView } from "@/lib/huntry/storefront-script/page-mode";
import { StorefrontEvent } from "@/lib/huntry/storefront-script/types";

const event = (slug: string, overrides: Partial<StorefrontEvent> = {}): StorefrontEvent => ({
  id: 1,
  name: slug.toUpperCase(),
  slug,
  description: "",
  startsAt: null,
  endsAt: null,
  headerBannerUrl: null,
  markerRadiusMeters: 50,
  maxGrabCount: 0,
  eggClaimCapacity: 1,
  colors: { primaryColor: "#f7a163", successColor: "#5dc564" },
  unclaimedIconUrl: null,
  claimedIconUrl: null,
  locationIconUrl: null,
  locationAnchor: "bottom",
  eggs: [],
  ...overrides,
});

describe("decideMode", () => {
  const events = [event("a"), event("b")];

  it("shows the listing with no slug, even with no events", () => {
    expect(decideMode(events)).toEqual({ kind: "listing", events });
    expect(decideMode([], undefined)).toEqual({ kind: "listing", events: [] });
    expect(decideMode(events, "")).toEqual({ kind: "listing", events });
  });

  it("shows the rewards list for ?view=rewards, ahead of any slug", () => {
    expect(decideMode(events, undefined, "rewards")).toEqual({ kind: "rewards" });
    expect(decideMode(events, "b", "rewards")).toEqual({ kind: "rewards" });
    expect(decideMode(events, undefined, "other")).toEqual({ kind: "listing", events });
  });

  it("opens the map for a known slug and reports an unknown one", () => {
    expect(decideMode(events, "b")).toEqual({ kind: "map", event: events[1] });
    expect(decideMode(events, "nope")).toEqual({ kind: "not-found" });
    expect(decideMode([], "a")).toEqual({ kind: "not-found" });
  });
});

describe("readView", () => {
  it("reads ?view= or a #rewards link", () => {
    expect(readView("?view=rewards", "")).toBe("rewards");
    expect(readView("", "#rewards")).toBe("rewards");
    expect(readView("?event=a", "#other")).toBeUndefined();
    expect(decideMode([], undefined, readView("", "#rewards"))).toEqual({ kind: "rewards" });
  });
});

describe("pageNavItems", () => {
  it("marks the active section and links both", () => {
    expect(pageNavItems("rewards", "/huntry/", "/huntry/?view=rewards")).toEqual([
      { label: "Hunts", href: "/huntry/", active: false },
      { label: "My Rewards", href: "/huntry/?view=rewards", active: true },
    ]);
  });
});

describe("buildCards", () => {
  it("orders by start date with undated events last, then by name", () => {
    const cards = buildCards([
      event("undated-b", { name: "B undated" }),
      event("late", { name: "Late", startsAt: "2026-10-09T00:00:00.000Z" }),
      event("undated-a", { name: "A undated" }),
      event("early", { name: "Early", startsAt: "2026-10-01T00:00:00.000Z" }),
    ]);

    expect(cards.map((card) => card.slug)).toEqual(["early", "late", "undated-a", "undated-b"]);
  });

  it("carries the text fields through untouched (rendered later with textContent)", () => {
    const [card] = buildCards([event("x", { name: "<b>Hi</b>", description: "<img src=x onerror=1>" })]);

    expect(card.name).toBe("<b>Hi</b>");
    expect(card.description).toBe("<img src=x onerror=1>");
  });
});

describe("formatDateRange / endsCountdown", () => {
  it("formats both, one-sided and missing dates", () => {
    const start = "2026-10-01T12:00:00.000Z";
    const end = "2026-10-10T12:00:00.000Z";

    expect(formatDateRange(start, end, "en-US", "UTC")).toBe("Oct 1, 2026 – Oct 10, 2026");
    expect(formatDateRange(null, end, "en-US", "UTC")).toBe("Until Oct 10, 2026");
    expect(formatDateRange(start, null, "en-US", "UTC")).toBe("From Oct 1, 2026");
    expect(formatDateRange(null, null)).toBe("");
    expect(formatDateRange("not a date", null)).toBe("");
  });

  it("counts down to the end, reports an ended hunt, and hides with no end date", () => {
    const now = Date.parse("2026-10-09T00:00:00.000Z");

    expect(endsCountdown("2026-10-09T01:01:01.000Z", now)).toBe("Ends in 01h 01m 01s");
    expect(endsCountdown("2026-10-08T00:00:00.000Z", now)).toBe("Hunt ended");
    expect(endsCountdown(null, now)).toBeNull();
    expect(endsCountdown("garbage", now)).toBeNull();
  });
});

describe("safeColor", () => {
  it("only lets plain hex values through", () => {
    expect(safeColor("#f7a163")).toBe("#f7a163");
    expect(safeColor("#fff")).toBe("#fff");
    expect(safeColor("red")).toBeNull();
    expect(safeColor("#fff; background:url(x)")).toBeNull();
    expect(safeColor("url(javascript:1)")).toBeNull();
    expect(safeColor(null)).toBeNull();
  });
});
