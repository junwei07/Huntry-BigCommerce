import { NextRequest, NextResponse } from "next/server";
import { ImageUploadError, uploadImage } from "@/lib/huntry/storage/image-storage";
import { isImageKind, MAX_IMAGE_BYTES } from "@/lib/huntry/storage/image-validation";
import { getStorageBucketName } from "@/lib/firebase/storage";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { logError } from "@/lib/errors/logger";
import { jsonError } from "@/lib/errors/json-error";

// Called by the admin UI's image fields (LogoUploadField). Authorized the
// same way a Server Action is (isAuthorizedForStore), and the object path is
// built from that authorized storeHash only — the client never chooses where
// in the bucket a file lands.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const storeHash = request.nextUrl.searchParams.get("storeHash") ?? undefined;

  if (!(await isAuthorizedForStore(storeHash)) || !storeHash) {
    return jsonError(403, NOT_AUTHORIZED_FOR_STORE_MESSAGE);
  }

  if (!getStorageBucketName()) {
    return jsonError(503, "Image uploads are not configured for this environment.");
  }

  // Cheap rejection before the body is buffered; multipart framing adds a
  // little overhead on top of the file itself.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (declaredLength > MAX_IMAGE_BYTES + 64 * 1024) {
    return jsonError(413, "Images must be 5 MB or smaller.");
  }

  try {
    const form = await request.formData();
    const kind = form.get("kind");
    const file = form.get("file");

    if (!isImageKind(kind)) {
      return jsonError(400, "Unknown image kind.");
    }

    if (!(file instanceof File)) {
      return jsonError(400, "No file was uploaded.");
    }

    const { url } = await uploadImage({ storeHash, kind, bytes: new Uint8Array(await file.arrayBuffer()) });

    return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return jsonError(400, error.message);
    }

    logError("POST /api/internal/huntry/upload-image", error);

    return jsonError(500, "Failed to upload the image.");
  }
}
