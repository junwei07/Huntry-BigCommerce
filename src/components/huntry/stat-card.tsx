import { ReactNode } from "react";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Stats card shared by the Rewards list and Overview.
export function StatRow({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "16px 0 24px" }}>{children}</div>;
}

export function StatCard({
  label,
  value,
  valueMuted,
  valueColor = HUNTRY_COLORS.link,
  sub,
}: {
  label: string;
  value: string | number;
  // The "/ N" part after the value.
  valueMuted?: string | number;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #E5E5EA",
        borderRadius: 12,
        padding: "16px 20px",
        minWidth: 160,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: HUNTRY_COLORS.textMuted,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 28, fontWeight: 800, color: valueColor }}>
        {value}
        {valueMuted === undefined ? null : (
          <span style={{ fontWeight: 600, color: HUNTRY_COLORS.textMuted }}> / {valueMuted}</span>
        )}
      </span>
      {sub ? <span style={{ fontSize: 12, color: HUNTRY_COLORS.textMuted }}>{sub}</span> : null}
    </div>
  );
}
