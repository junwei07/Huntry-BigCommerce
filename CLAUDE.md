# CLAUDE.md

@AGENTS.md

A BigCommerce single-click app (Next.js) whose feature is Huntry, migrated
from a legacy WordPress plugin (`huntry/`). `AGENTS.md` holds the git model,
doc style and secrets rules.

## Doc map

Everything below is read on demand, not auto-loaded. Each line is enough
to decide whether to open the file.

**App docs:**

- [`README.md`](README.md) — what the app is, plus dev and prod setup guides.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current app
  architecture (routing, auth, caching, API clients) — living spec.
- [`docs/LOCAL-SINGLE-CLICK-APP.md`](docs/LOCAL-SINGLE-CLICK-APP.md),
  [`docs/VERCEL-DEPLOYMENT.md`](docs/VERCEL-DEPLOYMENT.md) — local tunnel
  and Vercel deployment guides.
- [`docs/APP-SETUP-COMMON.md`](docs/APP-SETUP-COMMON.md) — callback
  URLs/scopes/secret-gen shared by the guides above.
- [`docs/big-design-modal-removechild-patch.md`](docs/big-design-modal-removechild-patch.md)
  — root cause + patch for a BigDesign `Modal` crash; re-check when bumping
  BigDesign.

**Huntry migration docs:**

- [`docs/MIGRATION.md`](docs/MIGRATION.md) — the migration design/plan:
  data model mapping, feature plan, phased rollout, open risks. Living.
- [`docs/FIREBASE-DEPLOYMENT.md`](docs/FIREBASE-DEPLOYMENT.md) — Firebase
  App Hosting deploy runbook, decisions and a progress table of what's done
  so far; also the BigCommerce marketplace publishing checklist. Living.
- [`docs/HUNTRY-UI-REFERENCE.md`](docs/HUNTRY-UI-REFERENCE.md) — which
  legacy app (WP plugin vs. Flutter reference apps) is the UI
  source-of-truth for each piece of the new admin UI.
- [`tickets.md`](tickets.md) — forward-looking BC-HUN-NNN ticket backlog
  ("what's left").
- [`HBC-CHANGELOG.md`](HBC-CHANGELOG.md) — log of already-shipped
  BC-HUN-NNN tickets with implementation detail ("what already shipped").
  Don't load this and `tickets.md` speculatively — they answer different
  questions.
- [`huntry/CLAUDE.md`](huntry/CLAUDE.md) — entry point into the legacy WP
  plugin's own doc tree (architecture, gotchas, ADRs). Open this when
  porting specific behavior from the WP plugin.
