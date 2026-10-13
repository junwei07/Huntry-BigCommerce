import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({ getRestApiClient: vi.fn() }));
vi.mock("@/lib/credentials-store/get-credentials-store", () => ({ getCredentialsStore: vi.fn() }));
vi.mock("@/lib/huntry/claims/redemption", () => ({ processOrderCreated: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const { logError } = await import("@/lib/errors/logger");
const { getRestApiClient } = await import("@/lib/bc-api-client/get-rest-api-client");
const { getCredentialsStore } = await import("@/lib/credentials-store/get-credentials-store");
const { processOrderCreated } = await import("@/lib/huntry/claims/redemption");
const { revalidateTag } = await import("next/cache");
const { eventClaimsTag } = await import("@/lib/huntry/claims/cache-tags");
const { POST } = await import("@/app/api/webhooks/huntry/order/route");

function webhookRequest(body: unknown): NextRequest {
  return new NextRequest("https://huntry-app.example.com/api/webhooks/huntry/order", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const payload = {
  scope: "store/order/created",
  producer: "stores/abc123",
  data: { type: "order", id: 500 },
};

const client = { get: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRestApiClient).mockResolvedValue(client as never);
  vi.mocked(processOrderCreated).mockResolvedValue({ matched: 0, updated: 0, eventIds: [] });
  vi.mocked(getCredentialsStore).mockReturnValue({ getStoreToken: vi.fn().mockResolvedValue("token") } as never);
});

describe("POST /api/webhooks/huntry/order", () => {
  it("re-fetches via the stored token and passes only the order id to the processor", async () => {
    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(getRestApiClient).toHaveBeenCalledWith("abc123", "token");
    expect(processOrderCreated).toHaveBeenCalledWith("abc123", 500, client);
  });

  it("drops the cached claim views of every event whose claims changed", async () => {
    vi.mocked(processOrderCreated).mockResolvedValue({ matched: 2, updated: 2, eventIds: [3, 4] });

    await POST(webhookRequest(payload));

    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith(eventClaimsTag(3), { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(eventClaimsTag(4), { expire: 0 });
  });

  it("acknowledges but ignores a malformed body", async () => {
    const response = await POST(webhookRequest({ nope: true }));

    expect(response.status).toBe(200);
    expect(processOrderCreated).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it("acknowledges but ignores a scope other than store/order/created", async () => {
    const response = await POST(webhookRequest({ ...payload, scope: "store/cart/updated" }));

    expect(response.status).toBe(200);
    expect(processOrderCreated).not.toHaveBeenCalled();
  });

  it("acknowledges and logs when the store has no stored token", async () => {
    vi.mocked(getCredentialsStore).mockReturnValue({ getStoreToken: vi.fn().mockResolvedValue(null) } as never);

    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(processOrderCreated).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it("acknowledges and logs when the processor throws", async () => {
    vi.mocked(processOrderCreated).mockRejectedValue(new Error("boom"));

    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(logError).toHaveBeenCalled();
  });
});
