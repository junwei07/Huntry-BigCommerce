# BigCommerce Single-Click App Starter Lab Project

A tutorial-shaped progressive history that teaches how to build a
BigCommerce single-click installable app on Next.js, using a gift
certificates manager as the worked example feature.

## Terminology and Git Model

This repository maintains two kinds of history **separately**:

- **Traditional branch** (`main`): a normal Git branch with stable,
  append-only history. Custom-code changes are made on feature branches,
  reviewed via pull request, and merged here. `main`'s history is never
  rewritten.
- **Progressive history**: a tutorial-shaped commit chain (clean framework
  install → setup/boilerplate → step commits → end metadata) rebuilt as
  an independent commit chain per project version, identified by a
  project-version tag plus step tags.

`main` and the latest progressive history have **different tip commits but
identical file trees**. Every change must be replicated across both, using
the `bcedu-lab-sync` skill, and verified with its `validate-sync` command.
**Note:** as of this writing, no `bcedu-lab-sync` skill exists on disk (no
`.claude/skills/` directory in this repo) — treat it as aspirational/
not-yet-built, not missing due to a session restart.

For the full tag-naming scheme, commit-history structure, the lab/
enhancement step breakdown, project-version/changelog mechanics, and the
framework install command, see
[`docs/PROGRESSIVE-HISTORY.md`](docs/PROGRESSIVE-HISTORY.md) — only needed
when rebuilding or extending the progressive history.

## File Removal - Protected Paths

When creating a clean orphan branch, protect these additional paths from
removal:

* `.env.local`
* `data/` (the gitignored local SQLite credentials file)
* `.dev.vars` (the gitignored local Cloudflare Workers dev vars)
* `.secrets.production` (the gitignored Cloudflare deployment secrets)

## Never Commit Local Secrets

These paths hold real credentials and must never be added to version control,
on any branch, in any commit:

* `.env.local`
* `.env.production.local`
* `.dev.vars`
* `.secrets.production`

The repository's `.gitignore` covers them, but **only from the commit that
introduces those rules onward**. When rebuilding a progressive history the
Cloudflare ignore rules do not exist until the Cloudflare enhancement, so
every commit before that point is unprotected — and the working tree still
holds the developer's real files.

Because of that, **never use `git add -A`, `git add .`, or `git commit -a`
while rebuilding or rebasing a history.** Stage explicit paths instead:

```shell
git add src/lib/example.ts docs/EXAMPLE.md
```

If a bulk add is genuinely unavoidable, verify the result before committing
and untrack anything unintended:

```shell
git status --short
git rm --cached .secrets.production .dev.vars
```

Deleting one of these files is equally damaging: the values usually cannot be
regenerated. See the protected-paths list above before any operation that
cleans the working tree.
