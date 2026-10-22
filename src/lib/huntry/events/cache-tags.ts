// Per-id tag for detail fetches (so one event's mutation doesn't invalidate
// another's cache), plus one shared tag for list fetches.
export function eventTag(id: number | string): string {
  return `huntry-event:${id}`;
}

export const EVENTS_LIST_TAG = "huntry-event:list";
