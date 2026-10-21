import { App, getApp, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";

// The one Firestore client for the process. Server-only: the Admin SDK
// authenticates through IAM (Application Default Credentials locally, the
// backend's service account on Firebase App Hosting) and bypasses security
// rules, so no API key or firebaseConfig exists anywhere in this app.
//
// The project (evms-demo-d1477) is shared with other apps and holds several
// named databases, so the database id is mandatory and never defaulted: the
// SDK's own fallback is "(default)", which belongs to another app.
const globalForFirestore = globalThis as unknown as { huntryFirestore?: Firestore };

export function getFirestoreDatabaseId(): string {
  const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();

  if (!databaseId) {
    throw new Error(
      "FIRESTORE_DATABASE_ID must be set when CREDENTIALS_STORE_DRIVER=FIRESTORE. It is never " +
        'defaulted: the project\'s "(default)" database belongs to another app.',
    );
  }

  return databaseId;
}

// Shared by Firestore and Cloud Storage so both hang off one Firebase app.
// Guarded so a hot reload (which re-evaluates this module) reuses the app.
export function getFirebaseApp(): App {
  return getApps().length > 0 ? getApp() : initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || undefined });
}

export function getFirestoreDb(): Firestore {
  if (globalForFirestore.huntryFirestore) {
    return globalForFirestore.huntryFirestore;
  }

  const databaseId = getFirestoreDatabaseId();
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

  // A leftover emulator variable in a deployed environment would send every
  // read and write to a host that does not exist. K_SERVICE is set by Cloud
  // Run (and so Firebase App Hosting) at runtime only.
  if (emulatorHost && process.env.K_SERVICE) {
    throw new Error("FIRESTORE_EMULATOR_HOST must not be set on Cloud Run.");
  }

  if (emulatorHost) {
    console.warn(`[firebase] Firestore calls go to the emulator at ${emulatorHost}, not a hosted database.`);
  }

  const db = getFirestore(getFirebaseApp(), databaseId);

  // settings() can only be applied once, before the first request. Optional BC
  // fields can be undefined, which Firestore otherwise rejects on write.
  db.settings({ ignoreUndefinedProperties: true });

  globalForFirestore.huntryFirestore = db;

  return db;
}
