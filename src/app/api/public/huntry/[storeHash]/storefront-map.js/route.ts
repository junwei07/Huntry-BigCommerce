import { NextResponse } from "next/server";
import { STOREFRONT_MAP_BUNDLE } from "@/lib/huntry/storefront-script/bundle.generated";
import { serveStorefrontScript } from "@/lib/huntry/storefront-script/serve-script";

// The lazily loaded map bundle (maplibre, markers, geolocation), injected by the
// loader in storefront-script.js only on pages that have a Huntry container and
// live events. It reads its config from window.HuntryStorefront, which the
// loader has already set, so it needs no prelude.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storeHash: string }> },
): Promise<NextResponse> {
  const { storeHash } = await params;

  return serveStorefrontScript(storeHash, () => STOREFRONT_MAP_BUNDLE);
}
