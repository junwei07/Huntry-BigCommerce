import { Box, Flex, FlexItem } from "@bigcommerce/big-design";
import { AppExtensionStatusBanner } from "@/components/huntry/app-extension-status-banner";
import { DataModeBanner } from "@/components/layout/data-mode-banner";
import { BrandHeader } from "@/components/layout/brand-header";
import { MainNav } from "@/components/layout/main-nav";
import { StoreHashProvider } from "@/components/ui/store-hash-context";
import { Suspense } from "react";

// The shell chrome has no dynamic dependency of its own, so this is a plain,
// sync Server Component that renders immediately regardless of how long
// `children` takes to resolve.
//
// StoreHashProvider is the only client component reading useParams() in this
// tree now (MainNav/AppExtensionStatusBanner/children all read storeHash from
// its context instead) — under cacheComponents, route params are "blocks
// navigation" data even from a Client Component, so it needs a Suspense
// boundary or Next throws. One boundary around the provider covers every
// consumer below it, so MainNav/AppExtensionStatusBanner no longer need their
// own.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <StoreHashProvider>
        <Box>
          <DataModeBanner />
          <AppExtensionStatusBanner />
          {/*
            Below the "wide" breakpoint, a table-heavy page is wider than a
            narrowed control-panel iframe can show alongside a fixed-width
            sidebar. flexDirection uses BigDesign's ResponsiveProp (real CSS
            @media queries), which measures the iframe's own content window
            rather than the parent control panel page.
          */}
          <Flex
            flexDirection={{ mobile: "column", wide: "row" }}
            padding="large"
            flexGap="1rem"
            alignItems={{ mobile: "stretch", wide: "flex-start" }}
          >
            <FlexItem flexGrow={1} flexShrink={1} flexBasis={{ mobile: "auto", wide: "0" }}>
              <Box paddingBottom="medium">
                <BrandHeader />
              </Box>
              <Box paddingBottom="large">
                <MainNav />
              </Box>
              <Box>{children}</Box>
            </FlexItem>
          </Flex>
        </Box>
      </StoreHashProvider>
    </Suspense>
  );
}
