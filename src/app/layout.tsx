import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import { BigDesignProvider } from "@/components/ui/big-design-provider";
import { StyledComponentsRegistry } from "@/components/ui/styled-components-registry";
import { ActionAlertsManager } from "@/components/ui/action-alerts";
import { GlobalLoadingOverlay } from "@/components/ui/global-loading";

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Huntry",
  description: "A BigCommerce single-click app for running map-based treasure-hunt rewards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sourceSans3.className}>
      <body>
        <StyledComponentsRegistry>
          <BigDesignProvider>
            {children}
            <ActionAlertsManager />
            <GlobalLoadingOverlay />
          </BigDesignProvider>
        </StyledComponentsRegistry>
      </body>
    </html>
  );
}
