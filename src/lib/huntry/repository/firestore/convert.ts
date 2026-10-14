import { createHash } from "node:crypto";
import { DocumentReference, Firestore, Timestamp } from "firebase-admin/firestore";

// Firestore returns Timestamp; the domain types use Date.
export function readDate(value: unknown): Date | null {
  if (value instanceof Timestamp) {
    return value.toDate();
  }

  return value instanceof Date ? value : null;
}

export function readRequiredDate(value: unknown): Date {
  return readDate(value) ?? new Date(0);
}

// Reservation docs (slugs, coupon codes) are keyed by a hash of the value: both
// can hold characters that are invalid in a document id ("/", ".", "..") or be
// long.
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Firestore caps a batch at 500 operations.
const DELETE_CHUNK = 400;

export async function deleteRefs(db: Firestore, refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += DELETE_CHUNK) {
    const batch = db.batch();

    for (const ref of refs.slice(start, start + DELETE_CHUNK)) {
      batch.delete(ref);
    }

    await batch.commit();
  }
}

// Plain ascending string compare (SQLite's BINARY collation), so list order is
// deterministic across runs and machines.
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// "Nulls last, then ascending", for the schedule sorts.
export function compareNullableDates(a: Date | null, b: Date | null): number {
  if (a === null && b === null) {
    return 0;
  }

  if (a === null) {
    return 1;
  }

  if (b === null) {
    return -1;
  }

  return a.getTime() - b.getTime();
}
