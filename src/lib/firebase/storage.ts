import type { getStorage } from "firebase-admin/storage";
import { getFirebaseApp } from "@/lib/firebase/admin";

// Server-only, same identity model as admin.ts: Application Default
// Credentials locally, the backend's service account when deployed. Huntry
// uploads go to a dedicated bucket (not the project's default one, whose
// rules and IAM are shared with EVMS), so the name is mandatory and never
// defaulted.
export function getStorageBucketName(): string | undefined {
  return process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined;
}

export function requireStorageBucketName(): string {
  const name = getStorageBucketName();

  if (!name) {
    throw new Error(
      "FIREBASE_STORAGE_BUCKET must be set to upload images. It is never defaulted: the project's " +
        "default bucket is shared with another app.",
    );
  }

  return name;
}

// Dynamic import keeps firebase-admin/storage out of builds and routes that
// never upload.
export type StorageBucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

export async function getStorageBucket(): Promise<StorageBucket> {
  const { getStorage } = await import("firebase-admin/storage");

  return getStorage(getFirebaseApp()).bucket(requireStorageBucketName());
}
