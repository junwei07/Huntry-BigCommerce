import { randomUUID } from "node:crypto";
import { getStorageBucket, requireStorageBucketName } from "@/lib/firebase/storage";
import { buildDownloadUrl, parseOwnedImagePath } from "@/lib/huntry/storage/image-urls";
import { ImageKind, MAX_IMAGE_BYTES, sniffImage } from "@/lib/huntry/storage/image-validation";

// The seam the upload route and Server Actions talk to, so tests can swap in
// an in-memory fake the same way get-huntry-repository.ts allows for data.
export interface ImageObjectStore {
  bucketName(): string;
  save(params: { path: string; bytes: Uint8Array; contentType: string; token: string }): Promise<void>;
  remove(path: string): Promise<void>;
}

const firebaseObjectStore: ImageObjectStore = {
  bucketName: requireStorageBucketName,
  async save({ path, bytes, contentType, token }) {
    const bucket = await getStorageBucket();

    // firebaseStorageDownloadTokens is what makes the object reachable at a
    // permanent ?alt=media&token= URL. Paths are uuid-unique and never
    // overwritten, so the cache can be immutable.
    await bucket.file(path).save(Buffer.from(bytes), {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
  },
  async remove(path) {
    const bucket = await getStorageBucket();

    await bucket.file(path).delete({ ignoreNotFound: true });
  },
};

let objectStore: ImageObjectStore = firebaseObjectStore;

export function setImageObjectStoreForTesting(store: ImageObjectStore | null): void {
  objectStore = store ?? firebaseObjectStore;
}

export class ImageUploadError extends Error {}

export async function uploadImage(params: {
  storeHash: string;
  kind: ImageKind;
  bytes: Uint8Array;
}): Promise<{ url: string; path: string }> {
  const { storeHash, kind, bytes } = params;

  if (bytes.length === 0) {
    throw new ImageUploadError("The image is empty.");
  }

  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageUploadError("Images must be 5 MB or smaller.");
  }

  const sniffed = sniffImage(bytes);

  if (!sniffed) {
    throw new ImageUploadError("Only JPEG, PNG and WebP images are supported.");
  }

  const path = `${storeHash}/${kind}/${randomUUID()}.${sniffed.extension}`;
  const token = randomUUID();

  await objectStore.save({ path, bytes, contentType: sniffed.contentType, token });

  return { url: buildDownloadUrl(objectStore.bucketName(), path, token), path };
}

// Best-effort: only ever deletes an object under this store's own prefix, and
// never throws, so a storage hiccup cannot block the database write that
// prompted the cleanup.
export async function deleteImageByUrl(url: string | null | undefined, storeHash: string | undefined): Promise<void> {
  if (!url || !storeHash) {
    return;
  }

  try {
    const path = parseOwnedImagePath(url, objectStore.bucketName(), storeHash);

    if (path) {
      await objectStore.remove(path);
    }
  } catch (error) {
    console.error("[image-storage] failed to delete image", error);
  }
}
