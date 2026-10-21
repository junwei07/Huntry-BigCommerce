// Pure URL helpers for Cloud Storage download-token URLs. No SDK imports.

const STORAGE_HOST = "https://firebasestorage.googleapis.com";

export function buildDownloadUrl(bucket: string, objectPath: string, token: string): string {
  return `${STORAGE_HOST}/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

// Every object a store uploads lives under `{storeHash}/`, so this prefix is
// the whole tenant boundary for URLs the app accepts back from a form.
function storeUrlPrefix(bucket: string, storeHash: string): string {
  return `${STORAGE_HOST}/v0/b/${bucket}/o/${encodeURIComponent(`${storeHash}/`)}`;
}

// Returns the object path when `url` is a download URL for this store's own
// prefix in this bucket, otherwise null. Used both to accept form input and
// to decide what deleteImage may touch, so a forged URL can never name
// another store's object.
export function parseOwnedImagePath(url: string, bucket: string, storeHash: string): string | null {
  if (!url.startsWith(storeUrlPrefix(bucket, storeHash))) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const encodedPath = parsed.pathname.split("/o/")[1];

  if (!encodedPath) {
    return null;
  }

  // new URL() accepts a malformed escape such as "%E0%A4%A"; decoding it throws.
  let objectPath: string;

  try {
    objectPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  // Reject traversal-looking paths even though GCS object names are flat.
  if (!objectPath.startsWith(`${storeHash}/`) || objectPath.split("/").some((part) => part === "..")) {
    return null;
  }

  return objectPath;
}

// A relative path (a public/ asset such as DEFAULT_SPONSOR_LOGO_URL).
function isPlaceholderAsset(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//");
}

// Decides which image URL a Server Action may persist. `submitted` comes from
// the client and is untrusted: it must be empty (keep `current`), unchanged,
// a bundled placeholder, or an object under this store's own prefix.
export function resolveSubmittedImageUrl(params: {
  submitted: string | undefined;
  current: string | null;
  fallback: string;
  storeHash: string | undefined;
  bucket: string | undefined;
}): { ok: true; url: string } | { ok: false } {
  const { submitted, current, fallback, storeHash, bucket } = params;
  const value = submitted?.trim() ?? "";

  if (value === "" || value === current) {
    return { ok: true, url: current ?? fallback };
  }

  if (isPlaceholderAsset(value)) {
    return { ok: true, url: value };
  }

  if (storeHash && bucket && parseOwnedImagePath(value, bucket, storeHash)) {
    return { ok: true, url: value };
  }

  return { ok: false };
}
