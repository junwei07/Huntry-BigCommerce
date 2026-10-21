import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { featuredFormSchema } from "@/lib/huntry/featured/featured-form-schema";

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-featured-api-test-"));
  process.env.DATA_MODE = "MULTITENANT";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  delete process.env.CREDENTIALS_STORE_DRIVER;
});

afterAll(() => {
  // Best-effort, see events-api.test.ts (the SQLite handle can lock the dir on Windows).
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

describe("storefront settings (SQLite)", () => {
  it("returns blank defaults for a store that never saved", async () => {
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    expect(await fetchStorefrontSettings("fresh-store")).toEqual({
      bannerDescription: "",
      productCtaTitle: "",
      productCtaDescription: "",
      bannerLogoUrl: "",
      bannerImageUrl: "",
    });
  });

  it("upserts, and a second save replaces the first", async () => {
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings, saveStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    await saveStorefrontSettings({ bannerDescription: "A", productCtaTitle: "B", productCtaDescription: "C", bannerLogoUrl: "", bannerImageUrl: "" }, "store-a");
    await saveStorefrontSettings({ bannerDescription: "A2", productCtaTitle: "", productCtaDescription: "C2", bannerLogoUrl: "https://img.example/l.png", bannerImageUrl: "https://img.example/b.png" }, "store-a");

    expect(await fetchStorefrontSettings("store-a")).toEqual({
      bannerDescription: "A2",
      productCtaTitle: "",
      productCtaDescription: "C2",
      bannerLogoUrl: "https://img.example/l.png",
      bannerImageUrl: "https://img.example/b.png",
    });
  });

  it("keeps stores isolated", async () => {
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings, saveStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    await saveStorefrontSettings({ bannerDescription: "mine", productCtaTitle: "", productCtaDescription: "", bannerLogoUrl: "", bannerImageUrl: "" }, "store-c");

    expect((await fetchStorefrontSettings("store-d")).bannerDescription).toBe("");
  });

  it("falls back to defaults instead of throwing when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/huntry/db/get-db", () => ({
      getHuntryDb: () => {
        throw new Error("db down");
      },
    }));

    const { fetchStorefrontSettingsOrDefaults: safeFetch } = await import("@/lib/huntry/featured/featured-api");

    expect(await safeFetch("store-e")).toEqual({ bannerDescription: "", productCtaTitle: "", productCtaDescription: "", bannerLogoUrl: "", bannerImageUrl: "" });

    vi.doUnmock("@/lib/huntry/db/get-db");
    vi.restoreAllMocks();
  });
});

describe("featuredFormSchema", () => {
  it("trims and allows blanks", () => {
    expect(
      featuredFormSchema.parse({ bannerDescription: "  hi  ", productCtaTitle: "", productCtaDescription: " ", bannerLogoUrl: "", bannerImageUrl: "" }),
    ).toEqual({ bannerDescription: "hi", productCtaTitle: "", productCtaDescription: "", bannerLogoUrl: "", bannerImageUrl: "" });
  });

  it("rejects over-long text", () => {
    const base = { bannerDescription: "", productCtaTitle: "", productCtaDescription: "", bannerLogoUrl: "", bannerImageUrl: "" };

    expect(featuredFormSchema.safeParse({ ...base, bannerDescription: "x".repeat(121) }).success).toBe(false);
    expect(featuredFormSchema.safeParse({ ...base, productCtaTitle: "x".repeat(121) }).success).toBe(false);
    expect(featuredFormSchema.safeParse({ ...base, productCtaDescription: "x".repeat(241) }).success).toBe(false);
  });
});
