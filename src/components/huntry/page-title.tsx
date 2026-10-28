import type { ReactNode } from "react";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Replaces Panel's `header` string, which can't be made bold. A plain <h3>
// with inline styles, not BigDesign's H3: that component discards `style`
// and `className`, and a styled-components class can be dropped at runtime
// (see layout/main-nav.tsx). Size/margin mirror BigDesign's H3 defaults.
export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h3
      style={{
        margin: "0 0 1rem",
        fontSize: "1.5rem",
        fontWeight: 700,
        lineHeight: 1.25,
        color: HUNTRY_COLORS.text,
      }}
    >
      {children}
    </h3>
  );
}
