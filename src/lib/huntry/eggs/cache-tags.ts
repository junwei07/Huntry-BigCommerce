// Per-id tag for single-egg fetches, one shared tag for every egg list, plus
// a per-event tag so placing/removing an egg in one event (BC-HUN-025/026)
// never invalidates another event's cached eggs. Mirrors events/rewards'
// cache-tags.ts shape.
export function eggTag(id: string): string {
  return `huntry-egg:${id}`;
}

export function eventEggsTag(eventId: number | string): string {
  return `huntry-egg:event:${eventId}`;
}

export const EGGS_LIST_TAG = "huntry-egg:list";
