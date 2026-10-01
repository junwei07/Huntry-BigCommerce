// Per-id tag for detail fetches (so one sponsor's mutation doesn't invalidate
// another's cache), plus one shared tag for list fetches. Mirrors
// events/cache-tags.ts's exact shape.
export function sponsorTag(id: number | string): string {
  return `huntry-sponsor:${id}`;
}

export const SPONSORS_LIST_TAG = "huntry-sponsor:list";
