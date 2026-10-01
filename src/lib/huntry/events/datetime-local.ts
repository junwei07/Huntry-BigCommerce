// Formats a Date for a native <input type="datetime-local"> value — using
// local-timezone getters (getFullYear/getMonth/getDate/getHours/getMinutes),
// not toISOString() (which is UTC and would shift the displayed time away
// from what was actually stored/intended when the store's timezone isn't
// UTC).
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
