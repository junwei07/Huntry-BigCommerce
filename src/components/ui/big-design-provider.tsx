"use client";

import { GlobalStyles } from "@bigcommerce/big-design";
import { theme } from "@bigcommerce/big-design-theme";
import { ThemeProvider } from "styled-components";

import { HUNTRY_PRIMARY_SCALE } from "@/lib/huntry/theme";

const huntryTheme = {
  ...theme,
  colors: { ...theme.colors, ...HUNTRY_PRIMARY_SCALE },
};

export function BigDesignProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={huntryTheme}>
      <GlobalStyles />
      {children}
    </ThemeProvider>
  );
}
