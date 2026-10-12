// SQLite TEXT timestamps written by the app are ISO; zone-less
// `datetime('now')` strings are UTC. `new Date("2026-10-01 10:00:00")` would
// read those as local time, so they get an explicit Z. Postgres hands back
// Date instances, which pass straight through.
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value);

  return new Date(value instanceof Date || /[zZ]|[+-]\d\d:?\d\d$/.test(text) ? (value as string | Date) : `${text.replace(" ", "T")}Z`);
}
