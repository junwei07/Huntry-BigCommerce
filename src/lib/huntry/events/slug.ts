// Server-side only — there's no slug form field (see
// docs/HUNTRY-UI-REFERENCE.md: the WP plugin has none either, deriving
// post_name from the Title invisibly). events-api.ts's createEvent calls
// these to compute and, on a (store_hash, slug) collision, deduplicate a
// slug from the event's name — the same behavior WordPress's own post_name
// uniqueness handling provides for free.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// attempt 1 is the bare slug; attempt 2+ appends "-2", "-3", ... — matches
// WordPress's own post_name dedup suffixing.
export function buildCandidateSlug(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
