import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CACHE_PROFILE_NONE } from "@/lib/cache/cache-profiles";
import { CUSTOMERS_PATH, Customer } from "@/lib/bc-customers/types";

export interface CustomersResult {
  items: Customer[];
}

// BigCommerce's wire channel_ids is nullable; store_credit_amounts is only
// present at all when the request passes include=storecredit. Every other
// field on Customer already matches the wire response as-is, so these are the
// only normalizations needed to match the Customer shape.
export interface CustomerWireRecord extends Omit<Customer, "channel_ids" | "store_credit_amounts"> {
  channel_ids: number[] | null;
  store_credit_amounts?: Array<{ amount: string }>;
}

function parseCustomer(record: CustomerWireRecord): Customer {
  return { ...record, channel_ids: record.channel_ids ?? [], store_credit_amounts: record.store_credit_amounts ?? [] };
}

// Looks up registered customer accounts by email. Uncached: callers act on
// the result immediately (e.g. forcing a claim for a player), so a stale read
// is never acceptable.
export async function fetchCustomersByEmailUncached(
  emails: string[],
  storeHash: string | undefined,
): Promise<CustomersResult> {
  const uniqueEmails = [...new Set(emails.filter((email) => email))];

  if (uniqueEmails.length === 0) {
    return { items: [] };
  }

  const apiClient = await getRestApiClient(storeHash);
  const { data: body } = await apiClient.get<V3ListResponse<CustomerWireRecord>>(CUSTOMERS_PATH, {
    cache: { profile: CACHE_PROFILE_NONE },
    params: {
      "email:in": uniqueEmails.join(","),
      include: "storecredit",
    },
  });

  return { items: body.data.map(parseCustomer) };
}
