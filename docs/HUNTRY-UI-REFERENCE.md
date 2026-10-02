# Huntry UI Reference

Standing reference for Huntry admin UI decisions, so a future ticket
(rewards/sponsors/map UI — BC-HUN-015 onward) doesn't have to re-derive
this from `huntry/EVMS/` itself. Written during BC-HUN-014.

## Two reference implementations

Beyond the WordPress plugin (`huntry/includes/`, `huntry/assets/js/`,
already used for BC-HUN-011–013's data model/status-computation work),
`huntry/EVMS/` is a **second** reference implementation: a Flutter admin
dashboard for the same concept. It's the source for this app's admin UI
layout and color scheme — the WordPress plugin has no admin UI of its own
worth visually copying (it's a WP-admin-page implementation); EVMS does.

Use EVMS for: list/card layout, form field grouping, color palette,
corner-radius conventions. Don't blindly copy EVMS's data model or
validation rules without reconciling them against this app's own
already-shipped schema (see "Reconciling EVMS with this app's schema"
below) — EVMS's Firestore-backed multi-tenant model (App → Events →
Companies/Rewards/Items) differs structurally from this app's
`store_hash`-scoped Postgres/SQLite schema, and EVMS has at least one
known bug worth not replicating (see "Known EVMS issues" below).

**Form field lists/requiredness/data model: use the WP plugin, not EVMS.**
After BC-HUN-014's first pass (EVMS-only) shipped, the user pointed out
the events creation form was wrong against the actual WP plugin source
(`huntry/includes/events/index.php`) — an extra slug field that shouldn't
exist, and missing item-marker/location-marker/theme-preset sections. The
WP plugin is the **authoritative source for what fields a create/edit
form has, their requiredness, and its own data model** (it's the original
implementation this whole migration ports); EVMS is a second, independent
admin UI for the same underlying concept, useful for visual/layout
inspiration but not a substitute for the plugin's own field list. Where
the two disagree on a field EVMS also happens to touch (see the theme
model and numeric-bounds sections below), the plugin generally wins
**unless already explicitly overridden by the user** — check for that
before "fixing" a discrepancy.

## Color palette — Huntry-scoped, not global

`src/lib/huntry/theme.ts` exports `HUNTRY_COLORS`, sourced from
`huntry/EVMS/lib/values/colors.dart`:

```ts
export const HUNTRY_COLORS = {
  primary: "#E88B59", // orange — primary/accent actions, active-status color
  background: "#FFF8F0", // cream — page background
  text: "#0F1322", // near-black — primary text
  textMuted: "#717182", // grey — secondary/muted text, disabled states
  link: "#10154A", // dark blue — clickable text
  destructive: "#E74C3C", // red — delete/destructive actions
  live: "#22C55E", // green — "live" status
} as const;
```

**Scoped to `src/components/huntry/**` only** — a deliberate decision, not
an oversight. The shared nav/shell (`src/components/gift-certs-manager/app-shell.tsx`,
`src/components/layout/main-nav.tsx`) and the still-present legacy
`gift-certs-manager` screens keep BigDesign's default theme. Apply
`HUNTRY_COLORS` via inline `style`/styled-components within Huntry
components, not by overriding BigDesign's global `ThemeProvider`.

Corner-radius convention observed in EVMS: pill/24px for inputs and
buttons, 12–16px for cards. Not rigidly enforced pixel-for-pixel in this
app's BigDesign-based UI (BigDesign's own components don't cleanly expose
override points for this) — approximate it where practical, prioritize
color/layout fidelity over exact radius matching.

## List layout: row cards, not BigDesign's `Table`

Every other list in this app (gift certificates, customers) uses
BigDesign's `Table` component. Huntry's admin lists use **row-style
cards** instead — `EventCard` (`src/components/huntry/events/list/event-card.tsx`)
is the template: thumbnail image, name, a colored status pill, and
secondary detail (date range), styled with `HUNTRY_COLORS`. This is a
deliberate divergence from this app's own Table convention, per explicit
direction to match EVMS's actual layout (EVMS's `EventCard`/`RewardCard`
are both row/card style, never a data table).

**Simplifications from EVMS's own list page**, not built into BC-HUN-014
and not expected to be added later without a specific reason:
- No "upcoming events" horizontal carousel — a presentation nicety, not
  core functionality.
- No drag-to-reorder (EVMS's `list_position`) — no backing column exists;
  `featured_order` (BC-HUN-015) is the closest analogue and is a numeric
  field, not a drag target, in this app's design.
- No live Active/Paused *toggle* on the card — `huntry_events` has no
  `is_active`-equivalent column, so status is always a **read-only**
  derived badge (`EVENT_STATUS_LABEL`/`EVENT_STATUS_COLOR`,
  `src/lib/huntry/events/status.ts`), not an interactive control.

## Creation UI: a route, not a modal

EVMS creates via a `showDialog` modal overlaying the list page (a 2-step
wizard). This app's creation pages are **routes**
(`/huntry/events/new`, etc.), per `docs/MIGRATION.md` §3's already-
documented route tree and this app's existing full-page navigation model
(`AuthorizedPage` gates every route, not every modal open). Style the
route to visually echo EVMS's card sectioning and palette; don't adopt
its modal mechanism.

`runServerAction` (`src/components/ui/action-alerts.tsx`) returns the
resolved `ActionResult` (not `Promise<void>`) specifically so a creation
form can navigate to the list on success:
```ts
const result = await runServerAction(() => createHuntryEvent(input, storeHash));
if (result.success) router.push(getAppUrl(storeHash, "/huntry/events"));
```

## Event branding: `theme` — colors, item markers, location marker

**Superseded from EVMS to the WP plugin's own model** (same-day
correction to BC-HUN-014). The WP plugin's create/edit event form
(`huntry_render_event_details_meta_box()`) has three marker/branding
sections, all folded into the single `theme` JSONB column per
`docs/MIGRATION.md`'s own comment on it ("marker/theme colors, custom
icon URLs"):

```ts
// src/lib/huntry/events/types.ts
export interface EventThemeColors {
  preset: number | null; // index into EVENT_THEME_PRESETS, or null for "Custom"
  primaryColor: string;
  successColor: string;
}
export interface EventItemMarker {
  source: "preset" | "custom";
  presetIndex: number | null; // 1-18 when source === "preset"
  unclaimedIconUrl: string | null; // when source === "custom"
  claimedIconUrl: string | null; // when source === "custom"
}
export interface EventLocationMarker {
  source: "preset" | "custom";
  presetIndex: number | null; // 1-4 when source === "preset"
  iconUrl: string | null; // when source === "custom"
}
export interface EventTheme {
  colors: EventThemeColors;
  itemMarker: EventItemMarker;
  locationMarker: EventLocationMarker;
}
```

- **Theme colour** (`EventThemeColors`): 6 presets, each a **primary +
  success** hex pair (`huntry_get_event_theme_presets()`: Orange
  `#f7a163`/`#5dc564` (default), Blue `#4da3ff`/`#e26d14`, Coral
  `#ff6b5b`/`#4caf50`, Purple `#a875f5`/`#34c77b`, Gold `#f5c518`/`#3c5522`,
  Teal `#2ec4b6`/`#10462d`), or "Custom" with 2 hex color pickers. This
  **replaces** the original EVMS-ported model (5 presets, 3-color
  title/gradient-start/gradient-end) entirely — structurally different,
  not just re-labeled. `preset` is persisted **explicitly**, unlike both
  EVMS's and the WP plugin's own approach of re-deriving the selected
  preset by string-matching the loaded colors on load — a fragile pattern
  not worth replicating either way.
- **Item markers** (`EventItemMarker`): the unclaimed+claimed egg icon
  pair, picked together as one of **18** linked presets, or custom (two
  URL inputs). Assets: `public/huntry/markers/item/sample_N.png` /
  `sample_N_claimed.png` (N = 1–18, copied from
  `huntry/assets/images/item-markers/`). Resolve via
  `getItemMarkerPresetUrls(presetIndex)`.
- **Player location marker** (`EventLocationMarker`): the player's own
  map pin, one of **4** presets or custom. Assets:
  `public/huntry/markers/location/current_marker_N.png` (N = 1–4, copied
  from `huntry/assets/images/location-markers/`). Resolve via
  `getLocationMarkerPresetUrl(presetIndex)`.
- **No real file upload** for "custom" in either marker section — no
  object storage exists in this starter (same constraint as
  `headerBannerUrl` below), so "custom" is a URL text input, not an
  upload widget. Labeled honestly (e.g. "Unclaimed icon URL"), not
  presented as a fake upload button.
- None of the three sections are required (the WP form has no `required`
  attribute on any of them) — `DEFAULT_ITEM_MARKER`/`DEFAULT_LOCATION_MARKER`
  (`source: "preset"`, `presetIndex: null`) represent "nothing configured,"
  matching the plugin's own fallback-to-nothing behavior.

Components: `theme-picker.tsx` (colors), `item-marker-picker.tsx`,
`location-marker-picker.tsx` (all in `src/components/huntry/events/`) —
reuse all three for any future Huntry concept/edit form that wants the
same pickers (e.g. a BC-HUN-015 edit form).

**Not ported**: EVMS's separate "map style" picker (`mapStyle`/
`mapImageNumber`, a Google Maps JSON tile theme) — a third, unrelated
EVMS-only theme concept with no WP plugin equivalent found. Out of scope
until there's a map admin UI (BC-HUN-023) — and worth fixing, not
replicating, when it lands: see "Known EVMS issues" below.

## Numeric bounds, reconciled against this app's schema

Originally sourced from `huntry/EVMS/lib/feature/event_setting/add_event/view_model/add_event_view_model.dart`'s
validation. The WP plugin's own form (`huntry_render_event_details_meta_box()`)
has **looser** rules for the same two fields — `max_grab_count` allows
`min="0"` (unlimited), and `marker_radius` only specifies `min="1"` with
no upper bound at all. Asked the user explicitly whether to switch these
two to the WP plugin's numbers now that it's the form's primary
reference: **both were kept as EVMS-sourced, deliberately** — see below.

| Field | EVMS bound | WP plugin bound | This app's rule | Notes |
| --- | --- | --- | --- | --- |
| `markerRadiusMeters` | 5–500m, default 10 | `min="1"`, no max | **5–500m** (EVMS, kept) | DB column default stays **25** (already migrated in BC-HUN-004) — not EVMS's 10. User explicitly chose to keep the 500m cap over dropping it to match WP. |
| `eggClaimCapacity` (≈ EVMS `maxVirtualGrabCount`, WP `huntry_event_egg_claim_capacity`) | `> 0`, no ceiling | `min="1"`, required | `> 0`, no ceiling | All three sources agree here — no conflict. |
| `maxGrabCount` (≈ EVMS `maxUserGrabCount`, WP `huntry_event_max_grab_count`) | `> 0`, no ceiling | **`min="0"` (0 = unlimited)** | **`> 0`, no ceiling** — EVMS, kept | **Divergence from both this column's own schema comment** (`0001_huntry_schema.sql`/`sqlite-schema.ts` comment `max_grab_count` as "0 = unlimited") **and the WP plugin's own form**. User explicitly re-confirmed keeping EVMS's stricter rule when asked directly, even after the rest of the form switched to the WP plugin as its reference. This makes `0` unreachable through event creation — a row could still end up `0` via direct DB access or a future code path, just never through this form. **Do not "fix" this toward WP or the schema comment** — it's a twice-confirmed, intentional decision, not an oversight. |

## Slug: no form field, server-derived

The WP plugin's form has **no slug input at all** — WordPress derives
`post_name` from the Title field invisibly, deduping automatically on
collision. This app's `slug` column (`UNIQUE (store_hash, slug)`) is the
same underlying concept, so it's handled the same way:
`src/lib/huntry/events/slug.ts`'s `slugify(name)` computes a base slug,
and `events-api.ts`'s `createEvent` retries with `-2`, `-3`, ... suffixes
(`buildCandidateSlug`) on a uniqueness collision, capped at 20 attempts.
**Never add a user-facing slug field** — that was BC-HUN-014's original
mistake, corrected same-day once checked against the WP plugin source.

## Image fields: placeholder defaults until real upload storage exists

No object storage exists in this starter outside the Cloudflare profile's
R2 bucket (reserved for cache, not app assets — `docs/MIGRATION.md` §8).
Two Huntry image fields are affected, and they currently take **different**
approaches to that gap:

- **`headerBannerUrl` (events)**: every event created today gets a fixed
  placeholder — `createHuntryEvent`
  (`src/app/store/[storeHash]/huntry/events/actions.ts`) always writes
  `headerBannerUrl: "/huntry/cookies-banner.png"`
  (`public/huntry/cookies-banner.png`, copied from the repo-root
  `assets/cookies-banner.png`) — **the creation form has no banner field
  at all.**
- **`logoUrl` (sponsors, BC-HUN-017 follow-up)**: same default asset
  (`createHuntrySponsor` writes `DEFAULT_SPONSOR_LOGO_URL`,
  `src/lib/huntry/sponsors/types.ts`), but the creation/edit forms **do**
  show a real upload control — `LogoUploadField`
  (`src/components/huntry/sponsors/logo-upload-field.tsx`), a tap-to-pick
  box styled after EVMS's own image pickers
  (`add_event_dialog.dart`/`add_company_dialog.dart`: tap a bordered box,
  pick a file, the preview swaps in). Picking a file only swaps a local
  preview (`URL.createObjectURL`) — there is nowhere to send it yet, so the
  sponsor still gets the fixed default on create, or keeps its existing
  logo on edit (`updateHuntrySponsor` re-fetches uncached and preserves
  `existing.logoUrl`, the same reasoning as events'
  `headerBannerUrl`/`isFeatured`/`featuredOrder` preserve-on-edit pattern
  below). The control is honest about this in its own caption text, rather
  than silently discarding a selection with no explanation.

Sponsors deliberately got the real upload *control* first, ahead of the
*storage* behind it, per explicit user direction — this is a front-end
affordance built intentionally ahead of its backend, not an oversight.
**BC-HUN-044** (`tickets.md`) tracks wiring both fields (and any future
Huntry image field) to actual persisted storage; when it lands, replace
`LogoUploadField`'s local-preview-only behavior with a real upload call,
and give events' `headerBannerUrl` the same control instead of no field at
all.

## Editing and deleting: kebab menu, per-record actions

Events gained a 3-dot kebab menu (`list/event-actions-menu.tsx`) matching
EVMS's own event card menu — Edit / Delete — built directly on this app's
own existing pattern, `GiftCertificateActionsMenu`
(`src/components/gift-certs-manager/gift-certificates/list/gift-certificate-actions-menu.tsx`):
BigDesign `Dropdown` + a `MoreHorizIcon`-only `Button` toggle + the
`dropdownKey`-remount workaround (documented there — a downshift/BigDesign
`Dropdown` stale-state bug) + a confirmation `Modal` for the destructive
action. Reuse this exact shape for rewards/sponsors kebab menus later.

- **Edit** navigates to `/huntry/events/[id]`, a 3-layer page (`page.tsx`
  → page-component → view-component, mirroring
  `GiftCertificateDetailPage`/`GiftCertificateView`) that fetches the
  record, pre-fills a form, and submits an update. Per-record Server
  Actions (`update*`/`delete*`) live in `events/[id]/actions.ts`, mirroring
  `gift-certs/[id]/actions.ts` — separate from the collection-level
  `events/actions.ts` that only holds `create*`.
- **The update action re-fetches uncached** (`fetchEventUncached`) right
  before writing, specifically to preserve whichever fields aren't in the
  edit form (`headerBannerUrl`, `isFeatured`, `featuredOrder`) instead of
  silently resetting them — the same reasoning
  `gift-certs/[id]/actions.ts`'s own re-fetch-before-mutate pattern
  documents. Any future edit form with fields the create form doesn't
  collect needs the same treatment.
- **Delete is a genuine hard delete**, confirmed explicitly with the user
  — `huntry_events` has no soft-delete/archive column (unlike
  `huntry_rewards`' `status`). Don't assume delete should be soft without
  checking the target table's actual schema first.
- **Shared form fields component**: `event-form-fields.tsx` takes one
  `state`/`onChange(patch)` pair (not ~20 individual props) and is used by
  both the create and edit forms — reuse this pattern (one state object +
  a patch-merging onChange) for any other Huntry create/edit form pair.
- **`datetime-local` pre-fill**: use local-timezone `Date` getters
  (`getFullYear`/`getHours`/etc.), never `toISOString()` — it's UTC and
  shifts the displayed time when the store's timezone isn't UTC.
  `src/lib/huntry/events/datetime-local.ts`'s `toDatetimeLocalValue`.

## Rewards (BC-HUN-019)

**No EVMS reference for the core fields.** `huntry/EVMS`'s `RewardDetail`
model has no discount type, discount value, discount scope, or product
picker at all — those are purely `huntry/includes/rewards/meta-box.php`
(`huntry_render_reward_details_meta_box()`) concepts, so unlike events,
there was no EVMS-vs-WP reconciliation to do here; the WP plugin is the only
field/requiredness source. EVMS's `CapacityCounter`/date-pair widgets and
its searchable sponsor dropdown were considered but not ported — this app's
plain `Input type="number"` and BigDesign `Select` already cover the same
ground without a bespoke widget.

**Gift Card Code is admin-editable, required, matching the WP form exactly**
(BC-HUN-020, reversing this doc's earlier "read-only, BC-HUN-020's
territory" note under BC-HUN-019 — per explicit user direction). Both
create and edit forms render a required "Gift Card Code" `Input` at the same
position the WP meta box uses (right after Number of Eggs, before Discount
Type), feeding `couponCode` straight into `createReward`/`updateReward` like
any other field. `coupon-sync.ts` uses the stored value verbatim as the real
BigCommerce coupon code. `bcPromotionId`/`bcCouponCodeId`/
`bcCustomerGroupId` are still populated later, exclusively by
`coupon-sync.ts`/BC-HUN-021 — never form fields.

**Hard delete only — no archive UI.** `docs/MIGRATION.md`'s original design
had `huntry_rewards.status = 'archived'` disable a reward's Promotion while
keeping its Customer Group as an audit trail. BC-HUN-018 shipped
hard-delete-only instead, per earlier explicit user direction (see
`rewards/types.ts`'s `RewardStatus` comment) — `RewardActionsMenu` offers
**Edit / Delete** only, matching `EventActionsMenu`/`SponsorActionsMenu`'s
shape exactly. Don't "fix" this toward an archive action without first
checking whether BC-HUN-020/021 (coupon-sync) has actually landed and
reintroduced a real use for `status`.

**`ProductPicker` is this app's first multi-select pattern.** Every other
Huntry picker (`theme-picker.tsx`, `item-marker-picker.tsx`,
`location-marker-picker.tsx`) is single-select; no BigDesign multi-select
component is used anywhere else in `src/`. `src/components/huntry/rewards/
product-picker.tsx` is a debounced search box over `fetchBcProductsForPicker`
(BC-HUN-018) plus a BigDesign `Checkbox` list, with already-selected
products pinned in their own "Selected" section so changing the search term
never silently drops a prior selection. Reuse this component (or its
pattern) for any future Huntry concept that needs to pick several
BigCommerce resources at once, rather than inventing a second multi-select
shape.

**List row has no thumbnail column.** Unlike `EventCard`/`SponsorCard`,
`RewardCard` has no logo/banner image to show (rewards have no such field),
so `REWARD_ROW_GRID_TEMPLATE` (`"1fr 140px 130px 48px"`) starts directly at
Name instead of a leading thumbnail cell — Name / Discount / Scope / kebab.

## Known EVMS issues — don't replicate

- **Map style picker is disconnected from what's saved.** EVMS's 4-tile
  "select map theme" UI sets `mapImageNumber` (1–4, display-only), but the
  actual applied style (`mapStyle`) is hardcoded to `MapStyles.styleJson[0]`
  in both the save and sample-event code paths — the picker's selection is
  never actually wired to the persisted style. If/when a map-theme picker
  is built here (BC-HUN-023+), wire the selection to what's actually
  applied.
- **Theme preset re-derived by string-matching** on load, rather than
  persisted explicitly — see the `EventTheme.preset` note above.
