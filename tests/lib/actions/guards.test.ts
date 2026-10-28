import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

const isAuthorizedForStore = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session/is-authorized-for-store", () => ({
  isAuthorizedForStore,
  NOT_AUTHORIZED_FOR_STORE_MESSAGE: "Not authorized for this store.",
}));
vi.mock("@/lib/errors/logger", () => ({ logError }));

import { actionFailure, denyUnlessAuthorized, parseActionInput } from "@/lib/actions/guards";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("denyUnlessAuthorized", () => {
  it("returns null when the session may act on the store", async () => {
    isAuthorizedForStore.mockResolvedValue(true);

    await expect(denyUnlessAuthorized("store-a")).resolves.toBeNull();
    expect(isAuthorizedForStore).toHaveBeenCalledWith("store-a");
  });

  it("returns the refusal otherwise", async () => {
    isAuthorizedForStore.mockResolvedValue(false);

    await expect(denyUnlessAuthorized("store-a")).resolves.toEqual({
      success: false,
      message: "Not authorized for this store.",
    });
  });
});

describe("parseActionInput", () => {
  const schema = z.object({ name: z.string().trim().min(1, "Name is required.") });

  it("returns the parsed (transformed) data", () => {
    expect(parseActionInput(schema, { name: "  Acme " }, "Invalid.")).toEqual({ ok: true, data: { name: "Acme" } });
  });

  it("returns the first issue's message as the failure", () => {
    expect(parseActionInput(schema, { name: "" }, "Invalid.")).toEqual({
      ok: false,
      result: { success: false, message: "Name is required." },
    });
  });

  it("uses zod's own message for a type error (the fallback only covers a missing issue)", () => {
    const result = parseActionInput(schema, "not an object", "Invalid.");

    expect(result).toMatchObject({ ok: false, result: { success: false } });
  });
});

describe("actionFailure", () => {
  it("logs the real error and returns only a safe message", () => {
    const error = new Error("db password leaked");

    expect(actionFailure("createThing: store a", error, "Failed to create the thing.")).toEqual({
      success: false,
      message: "Failed to create the thing.",
    });
    expect(logError).toHaveBeenCalledWith("createThing: store a", error);
  });

  it("surfaces an AppError's own vetted message", () => {
    const error = new AppError("UPSTREAM_API", "BigCommerce said no.");

    expect(actionFailure("ctx", error, "fallback").message).toBe("BigCommerce said no.");
  });
});
