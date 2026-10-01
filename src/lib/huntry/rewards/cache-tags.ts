// Per-id tag for detail fetches (so one reward's mutation doesn't invalidate
// another's cache), plus one shared tag for list fetches. Mirrors
// events/sponsors' cache-tags.ts exact shape.
export function rewardTag(id: number | string): string {
  return `huntry-reward:${id}`;
}

export const REWARDS_LIST_TAG = "huntry-reward:list";
