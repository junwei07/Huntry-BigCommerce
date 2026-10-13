"use client";

import { useState } from "react";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Layout and flow mirror the WP plugin's huntry_render_overview_game_activity()
// (huntry/includes/overview/game-activity.php) and huntry-overview-activity.js:
// newest first, client-side search + date-range filter over the rows already
// loaded, expandable rows, no pagination.

export interface ActivityItem {
  id: number;
  playerName: string;
  rewardName: string;
  couponCode: string;
  // ISO string — Dates are formatted in the viewer's timezone, never on the server.
  claimedAt: string;
  isForced: boolean;
  forcedByLabel: string | null;
}

const BORDER = "#E5E5EA";
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function initials(name: string): string {
  return name.replace(/^Customer #/, "").slice(0, 2).toUpperCase();
}

// Viewer-local yyyy-MM-dd, comparable with <input type="date"> values.
function localDateKey(iso: string): string {
  const date = new Date(iso);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const pill = (background: string, color: string): React.CSSProperties => ({
  background,
  color,
  fontSize: 10,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 4,
});

export function GameActivityPanel({ items, limit }: { items: ActivityItem[]; limit: number }) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<number>>(new Set());

  const needle = search.trim().toLowerCase();
  const dateActive = applied.from !== "" || applied.to !== "";
  const filtered = items.filter((item) => {
    if (needle && !`${item.playerName} ${item.rewardName}`.toLowerCase().includes(needle)) {
      return false;
    }

    const key = dateActive ? localDateKey(item.claimedAt) : "";

    return !((applied.from && key < applied.from) || (applied.to && key > applied.to));
  });
  const hasFilters = needle !== "" || dateActive;

  function clear() {
    setSearch("");
    setFrom("");
    setTo("");
    setApplied({ from: "", to: "" });
    setPopoverOpen(false);
  }

  function toggle(id: number) {
    setOpenIds((current) => {
      const next = new Set(current);

      if (!next.delete(id)) {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <section style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 12, padding: "16px 20px 20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: HUNTRY_COLORS.text }}>Game activity</h2>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <input
            aria-label="Search player or item"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search player or item..."
            style={{ padding: "6px 12px", borderRadius: 18, border: `1px solid ${BORDER}`, background: HUNTRY_COLORS.background, minWidth: 200 }}
            type="search"
            value={search}
          />
          <div style={{ position: "relative" }}>
            <button
              aria-expanded={popoverOpen}
              aria-label="Filter by date"
              onClick={() => setPopoverOpen((open) => !open)}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: `1px solid ${dateActive ? HUNTRY_COLORS.link : BORDER}`,
                background: dateActive ? HUNTRY_COLORS.link : "#fff",
                color: dateActive ? "#fff" : HUNTRY_COLORS.textMuted,
                cursor: "pointer",
              }}
              type="button"
            >
              📅
            </button>
            {popoverOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 6px)",
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  background: "#fff",
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: "0 4px 12px rgba(15, 19, 34, 0.12)",
                  minWidth: 180,
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: HUNTRY_COLORS.textMuted }}>
                  From
                  <input onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: HUNTRY_COLORS.textMuted }}>
                  To
                  <input onChange={(event) => setTo(event.target.value)} type="date" value={to} />
                </label>
                <button
                  onClick={() => {
                    setApplied({ from, to });
                    setPopoverOpen(false);
                  }}
                  style={{ ...pill(HUNTRY_COLORS.link, "#fff"), padding: "6px 10px", border: "none", cursor: "pointer", fontSize: 12 }}
                  type="button"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          <button
            onClick={clear}
            style={{ background: "none", border: "none", color: HUNTRY_COLORS.link, fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "6px 4px" }}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p style={{ textAlign: "center", color: HUNTRY_COLORS.textMuted, fontSize: 13, padding: "16px 0 4px" }}>
          No claims yet for this hunt.
        </p>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: "center", color: HUNTRY_COLORS.textMuted, fontSize: 13, padding: "16px 0 4px" }}>
          No activity matches your filters.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {filtered.map((item, index) => {
            const open = openIds.has(item.id);

            return (
              <div
                key={item.id}
                style={{
                  borderTop: index === 0 ? "none" : `1px solid ${BORDER}`,
                  padding: open ? "14px 12px" : "14px 4px",
                  ...(open ? { background: HUNTRY_COLORS.background, borderRadius: 8 } : {}),
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      flex: "0 0 auto",
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: BORDER,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 13,
                      color: HUNTRY_COLORS.text,
                    }}
                  >
                    {initials(item.playerName)}
                  </div>
                  <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 13, color: HUNTRY_COLORS.text }}>
                      <span>
                        <strong>{item.playerName}</strong> claimed
                      </span>
                      <span style={{ background: BORDER, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8 }}>
                        {item.rewardName}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      {/* Server and browser timezones differ, so the text is allowed to change on hydration. */}
                      <span style={{ fontSize: 12, color: HUNTRY_COLORS.textMuted }} suppressHydrationWarning>
                        {dateTimeFormatter.format(new Date(item.claimedAt))}
                      </span>
                      <span style={pill("rgba(93, 197, 100, 0.15)", "#2E9E37")}>Virtual</span>
                      {item.isForced && (
                        <span
                          style={pill(HUNTRY_COLORS.primary, "#fff")}
                          title={item.forcedByLabel ? `Force-claimed by ${item.forcedByLabel}` : "Force-claimed"}
                        >
                          Force Claimed
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    aria-expanded={open}
                    aria-label={open ? "Hide details" : "Show details"}
                    onClick={() => toggle(item.id)}
                    style={{
                      flex: "0 0 auto",
                      background: "none",
                      border: "none",
                      color: HUNTRY_COLORS.textMuted,
                      cursor: "pointer",
                      padding: 4,
                      transform: open ? "rotate(180deg)" : undefined,
                    }}
                    type="button"
                  >
                    ▾
                  </button>
                </div>
                {open && (
                  <div style={{ paddingLeft: 52 }}>
                    <hr style={{ border: 0, borderTop: `1px solid ${BORDER}`, margin: "12px 0" }} />
                    <h3 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: HUNTRY_COLORS.primary }}>Rewards:</h3>
                    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: HUNTRY_COLORS.link }}>{item.rewardName}</div>
                      <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: HUNTRY_COLORS.primary }}>
                        Gift Card Code: {item.couponCode}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {items.length >= limit && !hasFilters && (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: HUNTRY_COLORS.textMuted, textAlign: "center" }}>
          Showing the latest {limit} claims.
        </p>
      )}
    </section>
  );
}
