// Color palette sourced from huntry/EVMS/lib/values/colors.dart (the
// Flutter admin dashboard reference implementation — see
// docs/HUNTRY-UI-REFERENCE.md). Scoped to src/components/huntry/** only:
// the shared nav/shell and the legacy gift-certs-manager screens keep
// BigDesign's default theme untouched.
export const HUNTRY_COLORS = {
  primary: "#E88B59",
  background: "#FFF8F0",
  text: "#0F1322",
  textMuted: "#717182",
  link: "#10154A",
  destructive: "#E74C3C",
  live: "#22C55E",
} as const;

// Per-reward map marker/badge colors, cycled by reward id so the same reward
// keeps its color across the map markers, the items panel, and the legend.
export const EGG_MARKER_COLORS = ["#E88B59", "#3B82F6", "#22C55E", "#A855F7", "#EAB308", "#EC4899", "#14B8A6", "#EF4444"] as const;

export function eggMarkerColor(rewardId: number): string {
  return EGG_MARKER_COLORS[Math.abs(rewardId) % EGG_MARKER_COLORS.length];
}
