import { getAbsoluteAppUrl } from "@/lib/routing/app-url";
import { StorefrontConfig } from "./types";

// Builds the JS that sets window.__HUNTRY_STOREFRONT__ ahead of the bundle.
// Values go through JSON.stringify (never string concatenation). If APP_ORIGIN
// or BIGCOMMERCE_CLIENT_ID is unset the config is null and the bundle no-ops
// with a console warning, rather than every storefront page getting a 500.
export function buildStorefrontPrelude(storeHash: string): string {
  let config: StorefrontConfig | null = null;
  const clientId = process.env.BIGCOMMERCE_CLIENT_ID;

  try {
    const appOrigin = new URL(getAbsoluteAppUrl(undefined, "/")).origin;

    if (clientId) {
      config = { appOrigin, storeHash, clientId };
    }
  } catch {
    config = null;
  }

  return `window.__HUNTRY_STOREFRONT__=${JSON.stringify(config).replace(/</g, "\\u003c")};\n`;
}
