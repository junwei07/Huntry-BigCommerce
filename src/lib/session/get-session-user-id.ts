import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { readSession } from "@/lib/session/session-cookie";

// The acting admin's user id, for audit columns (e.g. huntry_claims.
// forced_by_user_id). MOCK/STATIC have no real session, so this is null there.
export async function getSessionUserId(): Promise<number | null> {
  if (getDataMode() !== "MULTITENANT") {
    return null;
  }

  return (await readSession())?.userId ?? null;
}
