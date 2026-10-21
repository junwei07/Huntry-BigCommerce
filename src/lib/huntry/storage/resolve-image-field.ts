import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getStorageBucketName } from "@/lib/firebase/storage";
import { resolveSubmittedImageUrl } from "@/lib/huntry/storage/image-urls";

export const INVALID_IMAGE_MESSAGE = "That image was not uploaded for this store. Upload it again.";

// The Server Actions' one entry point for an image URL posted by a form:
// binds resolveSubmittedImageUrl to the resolved store and configured bucket.
export function resolveImageField(params: {
  submitted: string | undefined;
  current: string | null;
  fallback: string;
  storeHash: string | undefined;
}): { ok: true; url: string } | { ok: false } {
  return resolveSubmittedImageUrl({
    submitted: params.submitted,
    current: params.current,
    fallback: params.fallback,
    storeHash: resolveStoreHash(params.storeHash),
    bucket: getStorageBucketName(),
  });
}
