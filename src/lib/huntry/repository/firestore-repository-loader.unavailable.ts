import type { HuntryRepository } from "@/lib/huntry/repository/types";

// Swapped in for firestore-repository-loader.ts by next.config.ts's
// turbopack.resolveAlias whenever CREDENTIALS_STORE_DRIVER isn't "FIRESTORE".
// It throws rather than returning a stub: if this is ever called, the alias and
// the runtime driver selection have drifted apart, and that should fail loudly.
export function createFirestoreHuntryRepository(): HuntryRepository {
  throw new Error(
    "The FIRESTORE Huntry repository is not available in this build (see next.config.ts's " +
      "turbopack.resolveAlias): CREDENTIALS_STORE_DRIVER must not be set to FIRESTORE here.",
  );
}
