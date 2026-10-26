# Huntry for BigCommerce

A BigCommerce single-click app on Next.js whose feature is Huntry: events,
rewards, sponsors, featured placements, a map and player claims, managed from
an admin UI inside the BigCommerce control panel. It is a migration of a legacy
WordPress plugin (`huntry/`), see `docs/MIGRATION.md`.

## Git model

`main` is the only maintained history: stable and append-only. Make changes on
feature branches, review via pull request, merge to `main`. Never rewrite
`main`'s history.

## Doc Style: Pointer-First

This repo is read almost entirely by coding agents, so new or edited docs
should default to an exact file/function/line pointer over restated prose —
the pattern already used throughout `huntry/docs/` (its gotchas table and
ADRs cite the exact legacy file/function behind every claim) and in
`CLAUDE.md`'s doc map (a pointer + one-line description, read on demand, not
auto-loaded).

When two docs would otherwise explain the same decision, pick one as
authoritative and have the other link to it rather than re-deriving the
rationale. Prefer "see `path/to/file.ts`" over restating what's already
readable in the code, and prefer a short index (name + one line) over a long
narrative when a reader just needs to decide whether to open something.

## Never Commit Local Secrets

These paths hold real credentials and must never be added to version control,
on any branch, in any commit:

* `.env.local`
* `.env.production.local`
* `.dev.vars`
* `.secrets.production`
* `data/` (the gitignored local SQLite files)

The repository's `.gitignore` covers them. Stage explicit paths instead of
using `git add -A`, `git add .` or `git commit -a`:

```shell
git add src/lib/example.ts docs/EXAMPLE.md
```

If a bulk add is unavoidable, check `git status --short` first and untrack
anything unintended with `git rm --cached <path>`. Deleting one of these files
is equally damaging: the values usually cannot be regenerated.
