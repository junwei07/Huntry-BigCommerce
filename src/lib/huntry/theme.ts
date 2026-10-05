// Color palette sourced from huntry/EVMS/lib/values/colors.dart (the
// Flutter admin dashboard reference implementation — see
// docs/HUNTRY-UI-REFERENCE.md). The primary ramp below is also applied
// app-wide as BigDesign's `colors.primary*` tokens (see
// src/components/ui/big-design-provider.tsx), so the nav, links, Tabs and
// primary Buttons all render in brand orange.
export const HUNTRY_COLORS = {
  primary: "#E88B59",
  background: "#FFF8F0",
  text: "#0F1322",
  textMuted: "#717182",
  link: "#10154A",
  destructive: "#E74C3C",
  live: "#22C55E",
} as const;

// Shade ramp mirroring BigDesign's primary10..primary70 tokens.
export const HUNTRY_PRIMARY_SCALE = {
  primary: HUNTRY_COLORS.primary,
  primary10: "#FDF3EC",
  primary20: "#FBE3D3",
  primary30: "#F4BE9C",
  primary40: HUNTRY_COLORS.primary,
  primary50: "#D9783F",
  primary60: "#BF6230",
  primary70: "#8F4A25",
} as const;

// Per-reward map marker/badge colors, cycled by reward id so the same reward
// keeps its color across the map markers, the items panel, and the legend.
export const EGG_MARKER_COLORS = ["#E88B59", "#3B82F6", "#22C55E", "#A855F7", "#EAB308", "#EC4899", "#14B8A6", "#EF4444"] as const;

export function eggMarkerColor(rewardId: number): string {
  return EGG_MARKER_COLORS[Math.abs(rewardId) % EGG_MARKER_COLORS.length];
}
