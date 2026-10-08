import { NextResponse } from "next/server";
import { STOREFRONT_BUNDLE } from "@/lib/huntry/storefront-script/bundle.generated";
import { buildStorefrontPrelude } from "@/lib/huntry/storefront-script/prelude";
import { serveStorefrontScript } from "@/lib/huntry/storefront-script/serve-script";

// The small loader (src/lib/huntry/storefront-script/index.ts), registered with
// Script Manager. Serves the config prelude followed by the bundle; the map is a
// separate script (storefront-map.js) that this one loads on demand.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;

  return serveStorefrontScript(storeHash, (hash) => buildStorefrontPrelude(hash) + STOREFRONT_BUNDLE);
}
