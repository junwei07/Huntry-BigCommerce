import { redirect } from "next/navigation";
import { getAppUrl } from "@/lib/routing/app-url";

// Landing target of the App Extension link shown on customer pages
// (APP_EXTENSION_INPUT.url in lib/huntry/app-extension-gql.ts): BigCommerce
// requires that url to carry the customer's `${id}`, so this route exists to
// receive it. There is no per-player view yet, so it forwards to the Overview;
// a future ticket can render the player's claims here instead. Under
// /store/[storeHash], so proxy.ts's session gate has already run.
export default async function Page({ params }: { params: Promise<{ storeHash: string }> }) {
  const { storeHash } = await params;

  redirect(getAppUrl(storeHash, "/huntry"));
}
