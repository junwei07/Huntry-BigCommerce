import { NextResponse } from "next/server";

// Scaffold only — registered via register-storefront-script.ts so a real
// script id exists in BigCommerce's Scripts API from Week 1, but the actual
// storefront bundle (proximity math, claim dialog, map rendering) is
// BC-HUN-034. This route never reads bc_app_session or calls
// isAuthorizedForStore — it's fetched directly by the merchant's storefront
// browser, not the admin iframe.
export async function GET(): Promise<NextResponse> {
  return new NextResponse("// Huntry storefront script — placeholder, populated in BC-HUN-034.\n", {
    headers: { "Content-Type": "application/javascript" },
  });
}
