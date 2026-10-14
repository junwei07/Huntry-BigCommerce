// Indirection point between get-huntry-repository.ts and the Firestore
// implementation, for the same reason as credentials-store/firestore-driver-loader.ts:
// next.config.ts's turbopack.resolveAlias swaps this specifier for
// firestore-repository-loader.unavailable.ts whenever CREDENTIALS_STORE_DRIVER
// isn't "FIRESTORE", keeping `firebase-admin` (and its gRPC stack) out of builds
// that would never select it.
export { createFirestoreHuntryRepository } from "@/lib/huntry/repository/firestore";
