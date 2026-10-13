import { LeaderboardRow } from "@/lib/huntry/claims/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

// Layout mirrors the WP plugin's huntry_render_overview_leaderboard()
// (huntry/includes/overview/index.php) and its .huntry-leaderboard-* CSS.
// Forced claims never reach this panel — fetchLeaderboard filters them in SQL.

const MEDALS = [
  { src: "/huntry/leaderboard/first_position.png", size: 44 },
  { src: "/huntry/leaderboard/second_position.png", size: 36 },
  { src: "/huntry/leaderboard/third_position.png", size: 36 },
];

// Podium order is 2nd, 1st, 3rd.
const PODIUM_ORDER = [1, 0, 2];

function playerName(row: LeaderboardRow): string {
  return row.customer ? row.customer.name || row.customer.email : `Customer #${row.bcCustomerId}`;
}

export function LeaderboardPanel({ rows }: { rows: LeaderboardRow[] }) {
  const rest = rows.slice(3);

  return (
    <section
      style={{
        flex: "1 1 280px",
        background: "#fff",
        border: "1px solid #E5E5EA",
        borderRadius: 12,
        padding: "16px 20px 20px",
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700, color: HUNTRY_COLORS.text }}>Leaderboard</h2>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {PODIUM_ORDER.map((index) => {
          const row = rows[index];
          const medal = MEDALS[index];

          return (
            <div
              key={index}
              style={{
                flex: 1,
                textAlign: "center",
                background: "rgba(93, 197, 100, 0.12)",
                borderRadius: 10,
                padding: "12px 6px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static medal assets under public/ */}
              <img alt="" height={medal.size} src={medal.src} style={{ objectFit: "contain" }} width={medal.size} />
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: HUNTRY_COLORS.textMuted }}>
                #{index + 1}
              </div>
              <div style={{ marginTop: 2, fontSize: 13, fontWeight: 700, color: HUNTRY_COLORS.text, overflowWrap: "anywhere" }}>
                {row ? playerName(row) : "—"}
              </div>
              <div style={{ marginTop: 2, fontSize: 18, fontWeight: 800, color: HUNTRY_COLORS.link }}>
                {row ? row.claimCount : "—"}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid #E5E5EA", paddingTop: 8 }}>
        {rest.length === 0 ? (
          <p style={{ margin: 0, paddingTop: 4, fontSize: 12, color: HUNTRY_COLORS.textMuted, textAlign: "center" }}>
            Ranks 4 and below appear here once more players have claimed something.
          </p>
        ) : (
          rest.map((row) => (
            <div
              key={row.bcCustomerId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 0",
                fontSize: 13,
                color: HUNTRY_COLORS.text,
              }}
            >
              <span>
                #{row.rank} {playerName(row)}
              </span>
              <strong>{row.claimCount}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
