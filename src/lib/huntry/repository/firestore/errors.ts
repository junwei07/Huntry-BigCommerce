// Thrown when a uniqueness reservation (event slug, reward coupon code, claim
// id) is already taken. The message deliberately contains "UNIQUE constraint
// failed", which is what isUniqueSlugConstraintError (events-api.ts) and
// isUniqueCouponCodeConstraintError (rewards-api.ts) recognise, so the facades
// and Server Actions need no Firestore-specific branch.
export class UniqueConstraintError extends Error {
  constructor(what: string) {
    super(`UNIQUE constraint failed: ${what}`);
    this.name = "UniqueConstraintError";
  }
}

// gRPC ALREADY_EXISTS, as raised by DocumentReference.create() and by a
// transaction's create() on an existing document.
export function isAlreadyExistsError(error: unknown): boolean {
  return (error as { code?: unknown }).code === 6;
}
