import { MockRouteHandler, MockRouteResponse } from "@/lib/bc-api-client/rest-client/mock-rest-client/types";
import { ApiRequestParams, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { CustomerWireRecord } from "@/lib/bc-customers/customers-api";
import { mockCustomers } from "@/lib/bc-customers/mock/mock-customers";
import { CUSTOMERS_PATH } from "@/lib/bc-customers/types";

function getStringParam(params: ApiRequestParams, key: string): string {
  const value = params[key];

  return typeof value === "string" ? value : "";
}

function getNumberParam(params: ApiRequestParams, key: string, fallback: number): number {
  const value = Number(params[key]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function paginate(
  items: CustomerWireRecord[],
  currentPage: number,
  itemsPerPage: number,
): V3ListResponse<CustomerWireRecord> {
  const startIndex = (currentPage - 1) * itemsPerPage;
  const data = items.slice(startIndex, startIndex + itemsPerPage);

  return {
    data,
    meta: {
      pagination: {
        total: items.length,
        count: data.length,
        per_page: itemsPerPage,
        current_page: currentPage,
        total_pages: Math.max(1, Math.ceil(items.length / itemsPerPage)),
      },
    },
  };
}

function handleCustomersListRequest(params: ApiRequestParams): V3ListResponse<CustomerWireRecord> {
  const idIn = getStringParam(params, "id:in")
    .split(",")
    .filter((value) => value !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));

  // id:in (batched lookup by id) takes priority over email:in and
  // pagination — the callers never combine them in a single request.
  if (idIn.length > 0) {
    const matches = mockCustomers.filter((customer) => idIn.includes(customer.id));

    return paginate(matches, 1, Math.max(matches.length, 1));
  }

  const emailIn = getStringParam(params, "email:in")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");

  const filtered =
    emailIn.length > 0
      ? mockCustomers.filter((customer) => emailIn.includes(customer.email.toLowerCase()))
      : mockCustomers;

  return paginate(filtered, getNumberParam(params, "page", 1), getNumberParam(params, "limit", 10));
}

export const customersListMockHandler: MockRouteHandler = {
  pattern: new RegExp(`^${CUSTOMERS_PATH}$`),
  handle: (_match, params): MockRouteResponse => ({ data: handleCustomersListRequest(params) }),
};
