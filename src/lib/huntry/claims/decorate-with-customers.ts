import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CUSTOMERS_PATH } from "@/lib/gift-certs-manager/customers/types";
import {
  ClaimCustomer,
  GameActivityRow,
  HuntryClaim,
  LeaderboardEntry,
  LeaderboardRow,
} from "@/lib/huntry/claims/types";

interface CustomerNameRecord {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

// Same decorate-with-* shape as gift-certs-manager: a batched live lookup
// keyed by id, since there is no local players table (docs/MIGRATION.md §1).
// A failed lookup must not take the whole page down — rows just fall back to
// the bare customer id.
async function fetchCustomersById(
  ids: number[],
  storeHash: string | undefined,
): Promise<Map<number, ClaimCustomer>> {
  const uniqueIds = [...new Set(ids)];
  const customers = new Map<number, ClaimCustomer>();

  if (uniqueIds.length === 0) {
    return customers;
  }

  try {
    const apiClient = await getRestApiClient(storeHash);
    const { data: body } = await apiClient.get<V3ListResponse<CustomerNameRecord>>(CUSTOMERS_PATH, {
      params: {
        "id:in": uniqueIds.join(","),
        limit: Math.min(uniqueIds.length, 250),
      },
    });

    for (const record of body.data) {
      customers.set(record.id, {
        id: record.id,
        name: `${record.first_name} ${record.last_name}`.trim(),
        email: record.email,
      });
    }
  } catch (error) {
    console.error("Failed to decorate Huntry claims with customer data", error);
  }

  return customers;
}

export async function decorateLeaderboardWithCustomers(
  entries: LeaderboardEntry[],
  storeHash: string | undefined,
): Promise<LeaderboardRow[]> {
  const customers = await fetchCustomersById(
    entries.map((entry) => entry.bcCustomerId),
    storeHash,
  );

  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    customer: customers.get(entry.bcCustomerId),
  }));
}

export async function decorateClaimsWithCustomers(
  claims: HuntryClaim[],
  storeHash: string | undefined,
): Promise<GameActivityRow[]> {
  const customers = await fetchCustomersById(
    claims.map((claim) => claim.bcCustomerId),
    storeHash,
  );

  return claims.map((claim) => ({ ...claim, customer: customers.get(claim.bcCustomerId) }));
}
