import { describe, expect, it } from "vitest";
import {
  buildSlides,
  cssUrl,
  darkenAccent,
  eventHref,
  HUNTRY_PAGE_PATH,
  parseProductId,
  productHasActiveReward,
  slideState,
  toAccent,
} from "@/lib/huntry/storefront-script/cta/model";
import { STOREFRONT_PAGE_URL } from "@/lib/huntry/register-storefront-page";
import { StorefrontCtaData, StorefrontCtaEvent } from "@/lib/huntry/storefront-script/types";

const NOW = new Date("2026-06-15T12:00:00Z").getTime();

function event(overrides: Partial<StorefrontCtaEvent> = {}): StorefrontCtaEvent {
  return {
    name: "Hunt",
    slug: "hunt",
    startsAt: "2026-06-01T00:00:00Z",
    endsAt: "2026-06-30T00:00:00Z",
    headerBannerUrl: null,
    primaryColor: "#f7a163",
    ...overrides,
  };
}

function data(overrides: Partial<StorefrontCtaData> = {}): StorefrontCtaData {
  return {
    events: [event()],
    allProducts: false,
    productIds: [],
    banner: { description: "", logoUrl: "https://app.example.com/huntry-logo.png", imageUrl: "https://app.example.com/b.png" },
    productCta: { title: "", description: "" },
    ...overrides,
  };
}

describe("page path", () => {
  it("matches the page the app provisions", () => {
    expect(HUNTRY_PAGE_PATH).toBe(STOREFRONT_PAGE_URL);
  });

  it("links an event by its slug, encoded", () => {
    expect(eventHref("a b&c")).toBe("/huntry/?event=a%20b%26c");
  });
});

describe("buildSlides", () => {
  it("makes one slide per live event and keeps the server order", () => {
    const slides = buildSlides(data({ events: [event({ slug: "b" }), event({ slug: "a" })] }), NOW);

    expect(slides.map((slide) => slide.href)).toEqual(["/huntry/?event=b", "/huntry/?event=a"]);
  });

  it("drops an event whose end has passed since the data was cached", () => {
    const slides = buildSlides(data({ events: [event({ endsAt: "2026-06-15T11:59:59Z" }), event({ slug: "ok" })] }), NOW);

    expect(slides.map((slide) => slide.href)).toEqual(["/huntry/?event=ok"]);
  });

  it("keeps an event with no end date", () => {
    expect(buildSlides(data({ events: [event({ endsAt: null })] }), NOW)).toHaveLength(1);
  });

  it("uses the event's own banner, else the default image", () => {
    const [own, fallback] = buildSlides(
      data({ events: [event({ headerBannerUrl: "https://cdn.example.com/e.png" }), event({ slug: "x" })] }),
      NOW,
    );

    expect(own.imageUrl).toBe("https://cdn.example.com/e.png");
    expect(fallback.imageUrl).toBe("https://app.example.com/b.png");
  });

  it("only passes plain hex colours through", () => {
    expect(toAccent("#F7A163")).toBe("#f7a163");
    expect(toAccent("red; background:url(x)")).toBeNull();
    expect(toAccent("#fff")).toBeNull();
    expect(darkenAccent(null)).toBeNull();
    expect(darkenAccent("#ffffff")).toBe("#4b4e59");
  });
});

describe("slideState", () => {
  const format = (ms: number) => `${ms}ms`;
  const [slide] = buildSlides(data(), NOW);

  it("shows the ends-in countdown while the event runs", () => {
    expect(slideState(slide, NOW, format)).toEqual({ endsText: `${slide.endsAt! - NOW}ms`, ended: false });
  });

  it("hides it with no end date and flags an ended slide", () => {
    expect(slideState({ ...slide, endsAt: null }, NOW, format)).toEqual({ endsText: null, ended: false });
    expect(slideState({ ...slide, endsAt: NOW }, NOW, format)).toEqual({ endsText: null, ended: true });
  });
});

describe("product CTA rules", () => {
  it("accepts only positive integer ids", () => {
    expect(parseProductId("112")).toBe(112);
    expect(parseProductId(" 7 ")).toBe(7);

    for (const bad of ["", "0", "-3", "1.5", "abc", "12abc", null, undefined]) {
      expect(parseProductId(bad)).toBeNull();
    }
  });

  it("shows for a store-wide reward or a named product, only while a hunt is live", () => {
    expect(productHasActiveReward(data({ allProducts: true }), 5)).toBe(true);
    expect(productHasActiveReward(data({ productIds: [5] }), 5)).toBe(true);
    expect(productHasActiveReward(data({ productIds: [6] }), 5)).toBe(false);
    expect(productHasActiveReward(data({ allProducts: true, events: [] }), 5)).toBe(false);
  });
});

describe("cssUrl", () => {
  it("cannot be broken out of with quotes or brackets", () => {
    const value = cssUrl('https://x.example.com/a").evil{(\'.png');

    expect(value.startsWith('url("')).toBe(true);
    expect(value.endsWith('")')).toBe(true);
    expect(value.slice(5, -2)).not.toMatch(/["'()]/);
  });
});
