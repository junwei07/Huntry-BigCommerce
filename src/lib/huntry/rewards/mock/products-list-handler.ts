import { MockRouteHandler, MockRouteResponse } from "@/lib/bc-api-client/rest-client/mock-rest-client/types";
import { ApiRequestParams, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { MOCK_PRODUCTS } from "@/lib/huntry/rewards/mock/mock-products";
import { BcProductSummary, PRODUCTS_PATH } from "@/lib/huntry/rewards/types";

// The real BigCommerce v3 catalog endpoint's "name:like" filter param is the
// only one the picker needs (BC-HUN-019's search box) — matched here
// case-insensitively against the fixture name, same spirit as a real
// partial-match filter.
function filterProducts(products: BcProductSummary[], params: ApiRequestParams): BcProductSummary[] {
  const nameFilter = params["name:like"];

  if (typeof nameFilter !== "string" || nameFilter.length === 0) {
    return products;
  }

  const needle = nameFilter.toLowerCase();

  return products.filter((product) => product.name.toLowerCase().includes(needle));
}

function handleProductsListRequest(params: ApiRequestParams): V3ListResponse<BcProductSummary> {
  const data = filterProducts(MOCK_PRODUCTS, params);

  return {
    data,
    meta: {
      pagination: {
        total: data.length,
        count: data.length,
        per_page: data.length,
        current_page: 1,
        total_pages: 1,
      },
    },
  };
}

export const productsListMockHandler: MockRouteHandler = {
  pattern: new RegExp(`^${PRODUCTS_PATH}$`),
  handle: (_match, params): MockRouteResponse => ({ data: handleProductsListRequest(params) }),
};
