import Image from "next/image";
import { Flex } from "@bigcommerce/big-design";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Logo + wordmark shown above the main nav. The wordmark uses an inline
// style rather than Text's color prop for the same styled-components
// registry reason documented in main-nav.tsx.
export function BrandHeader() {
  return (
    <Flex alignItems="center" flexGap="0.75rem">
      <Image src="/huntry-logo.png" alt="" width={40} height={36} priority />
      <span style={{ color: HUNTRY_COLORS.link, fontSize: "1.5rem", fontWeight: 700, lineHeight: 1.2 }}>Huntry</span>
    </Flex>
  );
}
