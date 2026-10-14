// Indirection point between get-credentials-store.ts and the real Firestore
// driver, for the same reason as postgres-driver-loader.ts: next.config.ts's
// turbopack.resolveAlias swaps this specifier for
// firestore-driver-loader.unavailable.ts whenever CREDENTIALS_STORE_DRIVER
// isn't "FIRESTORE", keeping `firebase-admin` (and its gRPC stack) out of
// builds that would never select it.
export { FirestoreCredentialsStore } from "@/lib/credentials-store/firestore-driver/firestore-credentials-store";
