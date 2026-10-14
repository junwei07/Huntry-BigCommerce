// BigCommerce store hashes are short alphanumeric strings. Public routes pass a
// URL segment straight into the data layer, and Firestore document ids are far
// less forgiving than a SQL bind parameter (a "/" becomes a path, "." and
// "__x__" are reserved, an empty id throws), so anything else is "no such store"
// rather than an error.
const STORE_HASH_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidStoreHash(storeHash: string): boolean {
  return STORE_HASH_PATTERN.test(storeHash);
}

export function assertValidStoreHash(storeHash: string): void {
  if (!isValidStoreHash(storeHash)) {
    throw new Error("Invalid store hash.");
  }
}
