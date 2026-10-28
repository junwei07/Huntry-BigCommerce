import Link from "next/link";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

export type Crumb = { label: string; href?: string };

const LINK_STYLE = { color: HUNTRY_COLORS.textMuted, textDecoration: "none" } as const;

// Port of the WP plugin's huntry_render_admin_breadcrumb (see
// huntry/includes/admin/index.php) — Add New/Edit subpages only, never the
// list screens. Every style is inline, not a styled-components class: a class
// can be dropped at runtime (see layout/main-nav.tsx), which would leave the
// links unstyled. A crumb with an href is a link; one without is the current
// page.
//
// hardNavigation renders a plain <a> (full iframe reload) instead of
// next/link: leaving a dynamic [id] route via a client-side transition can
// get stuck — see EditEventForm's handleSubmit — so the edit forms set it.
export function Breadcrumb({ crumbs, hardNavigation = false }: { crumbs: Crumb[]; hardNavigation?: boolean }) {
  if (crumbs.length === 0) {
    return null;
  }

  const LinkComponent = hardNavigation ? "a" : Link;

  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: "13px", margin: "0 0 0.75rem", color: HUNTRY_COLORS.textMuted }}>
      {crumbs.map((crumb, index) => (
        <span key={`${index}-${crumb.label}`}>
          {index > 0 && <span style={{ margin: "0 6px" }}>&gt;</span>}
          {crumb.href ? (
            <LinkComponent href={crumb.href} style={LINK_STYLE}>
              {crumb.label}
            </LinkComponent>
          ) : (
            <span aria-current="page" style={{ color: HUNTRY_COLORS.text, fontWeight: 600 }}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
