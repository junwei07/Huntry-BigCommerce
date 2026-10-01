# CLAUDE.md

@AGENTS.md

This repo is two things layered together:

1. A BigCommerce single-click-app **tutorial/starter-kit product**
   (`AGENTS.md` governs its dual-history git model).
2. An active **migration** of a legacy WordPress plugin (`huntry/`) into a
   real feature built on top of that starter kit.

Recent work is almost entirely (2) — building the Huntry events feature.

## Doc map

Everything below is read on demand, not auto-loaded. Each line is enough
to decide whether to open the file.

**Starter-kit product docs:**

- [`README.md`](README.md) — entry point: app purpose, data modes, links
  to the docs below.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current app
  architecture (routing, auth, caching, API clients) — living spec.
- [`docs/TUTORIAL.md`](docs/TUTORIAL.md) — learner-facing step-by-step lab
  walkthrough with diff links.
- [`docs/USING-AS-A-STARTER.md`](docs/USING-AS-A-STARTER.md) — keep/
  remove/update checklist for using this as a starter for a new app.
- [`docs/RUN-EXAMPLE-APP.md`](docs/RUN-EXAMPLE-APP.md),
  [`docs/LOCAL-SINGLE-CLICK-APP.md`](docs/LOCAL-SINGLE-CLICK-APP.md),
  [`docs/VERCEL-DEPLOYMENT.md`](docs/VERCEL-DEPLOYMENT.md),
  [`docs/CLOUDFLARE-DEPLOYMENT.md`](docs/CLOUDFLARE-DEPLOYMENT.md) — the
  deployment guide chain, in order.
- [`docs/CACHE-IMPLEMENTATION-SWAP.md`](docs/CACHE-IMPLEMENTATION-SWAP.md)
  — companion to ARCHITECTURE.md's caching section.

**Huntry migration docs:**

- [`docs/MIGRATION.md`](docs/MIGRATION.md) — the migration design/plan:
  data model mapping, feature plan, phased rollout, open risks. Living.
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
