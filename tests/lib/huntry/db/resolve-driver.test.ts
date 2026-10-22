import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCredentialsStoreDriver } from "@/lib/huntry/db/resolve-driver";

const ENV_KEYS = ["CREDENTIALS_STORE_DRIVER", "K_SERVICE", "HUNTRY_ALLOW_EPHEMERAL_SQLITE"] as const;

describe("resolveCredentialsStoreDriver", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("defaults to SQLITE when unset or blank", () => {
    expect(resolveCredentialsStoreDriver()).toBe("SQLITE");

    process.env.CREDENTIALS_STORE_DRIVER = "   ";

    expect(resolveCredentialsStoreDriver()).toBe("SQLITE");
  });

  it.each([
    ["sqlite", "SQLITE"],
    [" Postgres ", "POSTGRES"],
    [" firestore ", "FIRESTORE"],
  ])("normalizes %j to %s", (value, expected) => {
    process.env.CREDENTIALS_STORE_DRIVER = value;

    expect(resolveCredentialsStoreDriver()).toBe(expected);
  });

  it.each(["bogus", "firebase", "postgresql"])("throws on unrecognized value %j", (value) => {
    process.env.CREDENTIALS_STORE_DRIVER = value;

    expect(() => resolveCredentialsStoreDriver()).toThrow(/Unrecognized CREDENTIALS_STORE_DRIVER/);
  });

  it("throws for SQLITE (explicit or default) on Cloud Run", () => {
    process.env.K_SERVICE = "huntry";

    expect(() => resolveCredentialsStoreDriver()).toThrow(/Cloud Run/);

    process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";

    expect(() => resolveCredentialsStoreDriver()).toThrow(/Cloud Run/);
  });

  it("allows SQLITE on Cloud Run only with the explicit override", () => {
    process.env.K_SERVICE = "huntry";
    process.env.HUNTRY_ALLOW_EPHEMERAL_SQLITE = "1";

    expect(resolveCredentialsStoreDriver()).toBe("SQLITE");

    process.env.HUNTRY_ALLOW_EPHEMERAL_SQLITE = "true";

    expect(() => resolveCredentialsStoreDriver()).toThrow(/Cloud Run/);
  });

  it.each(["POSTGRES", "FIRESTORE"])("leaves the hosted driver %s alone on Cloud Run", (driver) => {
    process.env.K_SERVICE = "huntry";
    process.env.CREDENTIALS_STORE_DRIVER = driver;

    expect(resolveCredentialsStoreDriver()).toBe(driver);
  });
});
