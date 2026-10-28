import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestApiClient } from "@/lib/bc-api-client/rest-client/rest-client";
import { AppError } from "@/lib/errors/app-error";

// Characterization tests: they pin what RestApiClient does today, including the
// deliberate difference that reads are aborted after a timeout and writes are not.

const credentials = { storeHash: "abc123", apiToken: "secret-token" };

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function lastInit(): RequestInit {
  return fetchMock.mock.calls.at(-1)![1];
}

function lastUrl(): string {
  return fetchMock.mock.calls.at(-1)![0];
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    return error as AppError;
  }

  throw new Error("expected the request to fail");
}

describe("RestApiClient", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("get", () => {
    it("sends the auth headers and an abort signal, and builds the URL", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [1] }));

      const client = new RestApiClient(credentials);
      const { data } = await client.get<{ data: number[] }>("/v3/things", {
        params: { limit: 5, keyword: undefined, empty: "", flag: true },
      });

      expect(data).toEqual({ data: [1] });
      expect(lastUrl()).toBe("https://api.bigcommerce.com/stores/abc123/v3/things?limit=5&flag=true");
      expect(lastInit().headers).toEqual({ "X-Auth-Token": "secret-token", Accept: "application/json" });
      expect(lastInit().signal).toBeInstanceOf(AbortSignal);
      expect(lastInit().body).toBeUndefined();
    });

    it("returns undefined data on 204", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      const { data } = await new RestApiClient(credentials).get("/v2/things");

      expect(data).toBeUndefined();
    });

    it("throws an UPSTREAM_API error carrying the status and body on a non-2xx", async () => {
      fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));

      const error = await failureOf(new RestApiClient(credentials).get("/v2/things/9"));

      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe("UPSTREAM_API");
      expect(error.message).toBe("A BigCommerce API request failed.");
      expect(error.status).toBe(404);
      expect(error.cause).toBe('GET "/v2/things/9" failed with status 404: nope');
    });

    it("throws a clear error when a 2xx body is not JSON", async () => {
      fetchMock.mockResolvedValue(new Response("<html>blocked</html>", { status: 200 }));

      const error = await failureOf(new RestApiClient(credentials).get("/v2/things"));

      expect(error.code).toBe("UPSTREAM_API");
      expect(String(error.cause)).toContain('Response to "/v2/things" was not valid JSON: <html>blocked</html>');
    });

    it("wraps a network failure", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const error = await failureOf(new RestApiClient(credentials).get("/v2/things"));

      expect(error.code).toBe("UPSTREAM_API");
      expect(error.message).toBe("Could not reach BigCommerce.");
    });
  });

  describe("post, put and delete", () => {
    it.each([
      ["post", "POST"],
      ["put", "PUT"],
      ["delete", "DELETE"],
    ] as const)("%s sends a JSON body and NO abort signal", async (name, method) => {
      fetchMock.mockResolvedValue(jsonResponse({ data: { id: 1 } }));

      await new RestApiClient(credentials)[name]("/v3/things", { body: { a: 1 } });

      expect(lastUrl()).toBe("https://api.bigcommerce.com/stores/abc123/v3/things");
      expect(lastInit().method).toBe(method);
      expect(lastInit().headers).toEqual({
        "X-Auth-Token": "secret-token",
        Accept: "application/json",
        "Content-Type": "application/json",
      });
      expect(lastInit().body).toBe('{"a":1}');
      expect(lastInit().signal).toBeUndefined();
    });

    it("omits Content-Type and body when there is no body", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      const { data } = await new RestApiClient(credentials).delete("/v3/things/1");

      expect(data).toBeUndefined();
      expect(lastInit().headers).toEqual({ "X-Auth-Token": "secret-token", Accept: "application/json" });
      expect(lastInit().body).toBeUndefined();
    });

    it("throws an UPSTREAM_API error with the method in the cause on a non-2xx", async () => {
      fetchMock.mockResolvedValue(new Response("bad body", { status: 422 }));

      const error = await failureOf(new RestApiClient(credentials).post("/v3/things", { body: {} }));

      expect(error.code).toBe("UPSTREAM_API");
      expect(error.status).toBe(422);
      expect(error.cause).toBe('POST "/v3/things" failed with status 422: bad body');
    });

    it("throws a clear error when a 2xx body is not JSON", async () => {
      fetchMock.mockResolvedValue(new Response("oops", { status: 201 }));

      const error = await failureOf(new RestApiClient(credentials).post("/v3/things", { body: {} }));

      expect(String(error.cause)).toContain('Response to "/v3/things" was not valid JSON: oops');
    });

    it("wraps a network failure", async () => {
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));

      const error = await failureOf(new RestApiClient(credentials).put("/v3/things/1", { body: {} }));

      expect(error.message).toBe("Could not reach BigCommerce.");
    });
  });

  describe("credentials", () => {
    it.each([
      ["store hash", { storeHash: "", apiToken: "t" }],
      ["API token", { storeHash: "abc123", apiToken: "" }],
    ])("rejects a missing %s before any request", async (_label, partial) => {
      const client = new RestApiClient(partial);
      const readError = await failureOf(client.get("/v2/things"));
      const writeError = await failureOf(client.post("/v3/things"));

      expect(readError.code).toBe("VALIDATION");
      expect(writeError.code).toBe("VALIDATION");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting", () => {
    function rateLimited(): Response {
      return new Response("slow down", { status: 429, headers: { "X-Rate-Limit-Time-Reset-Ms": "500" } });
    }

    it("retries a read once after the reset delay", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(jsonResponse({ ok: true }));

      const pending = new RestApiClient(credentials).get("/v3/things");

      await vi.advanceTimersByTimeAsync(500);

      expect((await pending).data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries a write once after the reset delay", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(jsonResponse({ ok: true }));

      const pending = new RestApiClient(credentials).post("/v3/things", { body: {} });

      await vi.advanceTimersByTimeAsync(500);

      expect((await pending).data).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
