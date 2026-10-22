import { customersMockHandlers } from "@/lib/bc-customers/mock/handlers";
import { rewardsMockHandlers } from "@/lib/huntry/rewards/mock/handlers";
import { MockRouteHandler } from "@/lib/bc-api-client/rest-client/mock-rest-client/types";

// The only place that wires a feature's mock handlers into MockRestApiClient.
// To drop a feature from the mock client, remove its import and array entry
// here — MockRestApiClient itself never needs to change.
export const mockRouteHandlers: MockRouteHandler[] = [...customersMockHandlers, ...rewardsMockHandlers];
