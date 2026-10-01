import { productsListMockHandler } from "@/lib/huntry/rewards/mock/products-list-handler";
import { MockRouteHandler } from "@/lib/bc-api-client/rest-client/mock-rest-client/types";

// The list of mock handlers this feature contributes to MockRestApiClient.
// Delete this file's import from handler-registry.ts to drop the product
// picker's catalog lookup out of the mock client entirely.
export const rewardsMockHandlers: MockRouteHandler[] = [productsListMockHandler];
