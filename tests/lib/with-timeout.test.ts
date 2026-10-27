import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/lib/with-timeout";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise's value and clears its timer", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the original error and clears its timer", async () => {
    const failure = new Error("boom");

    await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects once the time limit passes", async () => {
    const pending = withTimeout(new Promise<string>(() => undefined), 1000);
    const assertion = expect(pending).rejects.toThrow("timed out after 1000ms");

    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
