"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "styled-components";
import { Box, Flex, Text } from "@bigcommerce/big-design";
import { AppLink } from "@/components/ui/app-link";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { getAppUrl } from "@/lib/routing/app-url";

// Unlike the old gift-certs-manager nav (two independent top-level sibling
// features, "/gift-certs" and "/customers"), Huntry is one feature mounted
// at "/huntry" with these as nested sub-routes underneath it (see
// app/store/[storeHash]/huntry/{page.tsx, map/, events/, rewards/,
// sponsors/, help/} and the matching app/(root)/huntry/... pass-throughs). isIndex
// marks the item served at "/huntry" itself (also the app's root path, via
// app/store/[storeHash]/page.tsx's pass-through) rather than a sub-route.
const NAV_ITEMS = [
  { id: "huntry", title: "Overview", isIndex: true },
  { id: "map", title: "Map", isIndex: false },
  { id: "events", title: "Events", isIndex: false },
  { id: "rewards", title: "Rewards", isIndex: false },
  { id: "sponsors", title: "Sponsors", isIndex: false },
  { id: "help", title: "Help", isIndex: false },
];

// A store-scoped path is "/store/<storeHash>/huntry/<subSection>" (see
// app-url.ts's getAppUrl) — segments[2] is always the fixed "huntry"
// feature prefix, so segments[3] is the actual sub-section. A root-level
// dev route (no storeHash, no "/store" prefix) has its sub-section at
// segments[1] instead, one past its own fixed "huntry" prefix.
//
// An absent sub-section segment means the index route ("/huntry" or
// "/store/<storeHash>/huntry", including via the "/"/"/store/<storeHash>"
// pass-throughs), which resolves to whichever item is flagged isIndex
// rather than leaving no item highlighted.
function getActiveSection(pathname: string, storeHash: string | undefined): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  const subSection = storeHash ? segments[3] : segments[1];

  if (!subSection) {
    return NAV_ITEMS.find((item) => item.isIndex)?.id;
  }

  return NAV_ITEMS.some((item) => item.id === subSection) ? subSection : undefined;
}

// Built from plain links rather than BigDesign's Tabs component, since this
// is cross-page navigation (each "tab" a separate route), not same-page tab
// panels — Tabs assumes an ARIA tablist with same-page panels. The
// pill-on-background look is deliberate, so it doesn't read as the same kind
// of control as the underline-style Tabs used on the detail page.
//
// Reads storeHash from the global StoreHashProvider context rather than a
// prop, so AppShell never needs to await params just to compute a value only
// this component uses.
export function MainNav() {
  const storeHash = useStoreHash();
  const pathname = usePathname();
  const activeSection = getActiveSection(pathname, storeHash);
  const theme = useTheme();

  return (
    <Flex alignItems="stretch" flexGap="0.5rem" role="navigation" aria-label="Main">
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === activeSection;

        return (
          // The pill is styled with an inline `style` rather than Box's
          // backgroundColor/padding props, which would resolve to a
          // styled-components generated class. Those classes are keyed to a
          // per-component "group" whose id is allocated per module registry,
          // and this app renders through two of them: the build-time
          // prerender bakes its style tags (with GlobalStyles present, so
          // StyledBox lands on group 3) into the shell HTML, while the
          // running server streams the dynamic content from a fresh registry
          // where StyledBox instead takes group 1. Rehydration pins
          // component -> group in tag order, so the later id wins and later
          // inserts for that component compute a CSSOM index from the wrong
          // group's bookkeeping; styled-components v5 swallows the resulting
          // insertRule failure (`catch { return false }`), dropping the rule
          // silently and permanently. That is what removed this pill's
          // background and padding inside the BigCommerce control panel.
          //
          // Inline styles are attribute-level, so they never participate in
          // that group bookkeeping and cannot be dropped by it. Values come
          // from the theme rather than literals so they stay in step with
          // BigDesign. Measured in production output: only the prerender and
          // runtime registries disagree (8 components affected, StyledBox
          // among them); `next dev` runs one registry and shows none.
          <Box
            key={item.id}
            style={{
              backgroundColor: isActive ? theme.colors.primary10 : undefined,
              borderRadius: "9999px",
              paddingBlock: theme.spacing.xSmall,
              paddingInline: theme.spacing.medium,
            }}
          >
            <AppLink
              aria-current={isActive ? "page" : undefined}
              href={getAppUrl(storeHash, item.isIndex ? "/huntry" : `/huntry/${item.id}`)}
              style={{ textDecoration: "none" }}
            >
              <Text bold color={isActive ? "primary" : "secondary70"} margin="none">
                {item.title}
              </Text>
            </AppLink>
          </Box>
        );
      })}
    </Flex>
  );
}
