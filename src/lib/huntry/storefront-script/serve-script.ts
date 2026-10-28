import { NextResponse } from "next/server";
import { isKnownStore } from "@/lib/huntry/public-api/known-store";

// The loader's prelude embeds env-derived values, so keep the shared-cache
// lifetime short enough that a config change reaches storefronts quickly. The
// map bundle uses the same lifetime so loader and map never drift far apart.
// Not in `next dev`: there a rebuilt bundle must show up on the next reload.
const cacheControl = () =>
  process.env.NODE_ENV === "development" ? "no-store" : "public, max-age=300, s-maxage=300";

const JS_TYPE = "application/javascript; charset=utf-8";

// Shared by the two storefront script routes. Public and unauthenticated by
// design (docs/MIGRATION.md §4): they are fetched by the merchant's storefront
// browser through a plain <script src>, so they never read bc_app_session and
// need no CORS. An unknown store gets a 404 so a made-up hash isn't served.
export async function serveStorefrontScript(
  storeHash: string,
  buildSource: (storeHash: string) => string,
): Promise<NextResponse> {
  if (!(await isKnownStore(storeHash))) {
    return new NextResponse("// Not found.\n", {
      status: 404,
      headers: { "Content-Type": JS_TYPE, "Cache-Control": "no-store" },
    });
  }

  return new NextResponse(buildSource(storeHash), {
    headers: { "Content-Type": JS_TYPE, "Cache-Control": cacheControl() },
  });
}
