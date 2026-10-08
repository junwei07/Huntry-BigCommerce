// Maps a claims-route response (src/app/api/public/huntry/[storeHash]/claims/
// route.ts) to the dialog the player should see. Reads the JSON body only:
// cross-origin, Retry-After isn't exposed to the script, but the 429 body
// carries retryAfterSeconds.
export type ClaimOutcome =
  | { kind: "claimed"; couponCode: string }
  | { kind: "already-claimed-by-me"; couponCode: string }
  | { kind: "guest" }
  | { kind: "too-far" }
  | { kind: "full" }
  | { kind: "limit-reached" }
  | { kind: "not-live" }
  | { kind: "unavailable" }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "slow-down" }
  | { kind: "retry-later" }
  | { kind: "not-found" }
  | { kind: "error" };

const DEFAULT_RETRY_AFTER_SECONDS = 60;

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function toClaimOutcome(status: number, body: unknown): ClaimOutcome {
  const data = asRecord(body);
  const error = typeof data.error === "string" ? data.error : "";
  const couponCode = typeof data.couponCode === "string" && data.couponCode ? data.couponCode : null;

  if (status === 200) {
    return couponCode ? { kind: "claimed", couponCode } : { kind: "error" };
  }

  if (status === 401) return { kind: "guest" };
  if (status === 403 && error === "too_far") return { kind: "too-far" };
  if (status === 404) return { kind: "not-found" };

  if (status === 409) {
    switch (error) {
      case "duplicate":
        return couponCode ? { kind: "already-claimed-by-me", couponCode } : { kind: "error" };
      case "capacity_full":
        return { kind: "full" };
      case "limit_reached":
        return { kind: "limit-reached" };
      case "event_not_live":
        return { kind: "not-live" };
      case "reward_unavailable":
        return { kind: "unavailable" };
      default:
        return { kind: "error" };
    }
  }

  if (status === 429) {
    if (error === "rate_limited") {
      const seconds = typeof data.retryAfterSeconds === "number" ? data.retryAfterSeconds : DEFAULT_RETRY_AFTER_SECONDS;

      return { kind: "rate-limited", retryAfterSeconds: seconds };
    }

    return { kind: "slow-down" };
  }

  if (status === 502 || status === 503) return { kind: "retry-later" };

  return { kind: "error" };
}
