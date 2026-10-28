import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getStoreToken = vi.hoisted(() => vi.fn());
const buildPreflightHeaders = vi.hoisted(() => vi.fn());

vi.mock("@/lib/credentials-store/get-credentials-store", () => ({
  getCredentialsStore: () => ({ getStoreToken }),
}));
vi.mock("@/lib/huntry/public-api/cors", () => ({ buildPreflightHeaders }));

import { handlePublicPreflight, isKnownStore } from "@/lib/huntry/public-api/known-store";

beforeEach(() => {
  getStoreToken.mockReset().mockResolvedValue({ accessToken: "t" });
  buildPreflightHeaders.mockReset().mockResolvedValue({ "Access-Control-Allow-Origin": "https://shop.example.com" });
});

afterEach(() => {
  delete process.env.DATA_MODE;
});

describe("isKnownStore", () => {
  describe("store hash shape", () => {
    beforeEach(() => {
      process.env.DATA_MODE = "MOCK";
    });

    it.each(["abc123", "a", "a".repeat(32)])("accepts %s", async (hash) => {
      await expect(isKnownStore(hash)).resolves.toBe(true);
    });

    it.each(["", "a".repeat(33), "ABC123", "abc_12", "abc-12", "bad hash", "abc/12", "..", "__proto__"])(
      "rejects %j",
      async (hash) => {
        await expect(isKnownStore(hash)).resolves.toBe(false);
      },
    );

    it("never consults the credentials store in MOCK mode", async () => {
      await isKnownStore("abc123");

      expect(getStoreToken).not.toHaveBeenCalled();
    });
  });

  describe("MULTITENANT mode", () => {
    beforeEach(() => {
      process.env.DATA_MODE = "MULTITENANT";
    });

    it("accepts a well-formed hash that has a stored token", async () => {
      await expect(isKnownStore("abc123")).resolves.toBe(true);
      expect(getStoreToken).toHaveBeenCalledWith("abc123");
    });

    it("rejects a well-formed hash with no stored token", async () => {
      getStoreToken.mockResolvedValue(undefined);

      await expect(isKnownStore("abc123")).resolves.toBe(false);
    });

    it("does not look up a malformed hash at all", async () => {
      await expect(isKnownStore("ABC123")).resolves.toBe(false);
      expect(getStoreToken).not.toHaveBeenCalled();
    });
  });
});

describe("handlePublicPreflight", () => {
  function preflight(storeHash: string) {
    return handlePublicPreflight(
      new Request(`https://app.example.com/api/public/huntry/${storeHash}/claims`, {
        method: "OPTIONS",
        headers: { Origin: "https://shop.example.com" },
      }),
      storeHash,
    );
  }

  beforeEach(() => {
    process.env.DATA_MODE = "MOCK";
  });

  it("answers a known store with its preflight headers", async () => {
    const response = await preflight("abc123");

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://shop.example.com");
    expect(buildPreflightHeaders).toHaveBeenCalledWith("https://shop.example.com", "abc123");
  });

  it("answers an unknown store with only Vary: Origin and never resolves CORS", async () => {
    const response = await preflight("BAD HASH");

    expect(response.status).toBe(204);
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(buildPreflightHeaders).not.toHaveBeenCalled();
  });
});
