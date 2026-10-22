// BigCommerce's v3 customers endpoint has no single-resource path — even a
// single lookup goes through this path with filters (e.g. id:in) rather than
// a /{id} suffix.
export const CUSTOMERS_PATH = "/v3/customers";

// Matches the BigCommerce v3 customer resource's field names directly.
// channel_ids is normalized from the wire's nullable array to always be an
// array (see customers-api.ts). store_credit_amounts stays the raw
// per-currency array.
export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  origin_channel_id: number;
  channel_ids: number[];
  store_credit_amounts: Array<{ amount: string }>;
  date_created: string;
}
