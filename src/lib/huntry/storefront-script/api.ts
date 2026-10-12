import { ClaimOutcome, toClaimOutcome } from "./claim-outcome";
import { StorefrontConfig, StorefrontMapData, StorefrontReward } from "./types";

const publicUrl = (config: StorefrontConfig, path: string) =>
  `${config.appOrigin}/api/public/huntry/${encodeURIComponent(config.storeHash)}/${path}`;

export async function fetchMapData(config: StorefrontConfig, eventSlug?: string): Promise<StorefrontMapData> {
  const query = eventSlug ? `?event=${encodeURIComponent(eventSlug)}` : "";
  const response = await fetch(publicUrl(config, `map-data${query}`));

  if (!response.ok) {
    throw new Error(`Huntry map-data failed (${response.status})`);
  }

  const body = (await response.json()) as Partial<StorefrontMapData>;

  return { events: Array.isArray(body.events) ? body.events : [] };
}

// Same-origin request to the storefront's own BigCommerce endpoint. Returns
// null for a guest (404) — the caller redirects to /login.php. The token is
// short-lived, so it is fetched right before each claim and never stored.
export async function fetchCustomerJwt(config: StorefrontConfig): Promise<string | null> {
  const response = await fetch(`/customer/current.jwt?app_client_id=${encodeURIComponent(config.clientId)}`, {
    credentials: "same-origin",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`customer/current.jwt failed (${response.status})`);

  const jwt = (await response.text()).trim();

  return jwt || null;
}

// One claim attempt: fresh JWT, then POST. Never throws — network failures
// come back as { kind: "error" } so the dialog layer has a single path.
export async function submitClaim(
  config: StorefrontConfig,
  eggId: string,
  lat: number,
  lng: number,
): Promise<ClaimOutcome> {
  try {
    const jwt = await fetchCustomerJwt(config);

    if (!jwt) return { kind: "guest" };

    const response = await fetch(publicUrl(config, "claims"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt, eggId, lat, lng }),
    });

    return toClaimOutcome(response.status, await response.json().catch(() => null));
  } catch {
    return { kind: "error" };
  }
}

// BC-HUN-046: the signed-in shopper's claims. "guest" when there is no session
// (the caller shows a login prompt); "error" for anything else, so callers have
// a single non-throwing path like submitClaim.
export type MyRewardsResult = { kind: "ok"; rewards: StorefrontReward[] } | { kind: "guest" } | { kind: "error" };

export async function fetchMyRewards(config: StorefrontConfig): Promise<MyRewardsResult> {
  try {
    const jwt = await fetchCustomerJwt(config);

    if (!jwt) return { kind: "guest" };

    const response = await fetch(publicUrl(config, "rewards"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt }),
    });

    if (response.status === 401) return { kind: "guest" };
    if (!response.ok) return { kind: "error" };

    const body = (await response.json().catch(() => null)) as { claims?: StorefrontReward[] } | null;

    return { kind: "ok", rewards: Array.isArray(body?.claims) ? body.claims : [] };
  } catch {
    return { kind: "error" };
  }
}
