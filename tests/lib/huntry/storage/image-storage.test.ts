import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteImageByUrl,
  ImageObjectStore,
  ImageUploadError,
  setImageObjectStoreForTesting,
  uploadImage,
} from "@/lib/huntry/storage/image-storage";
import { parseOwnedImagePath, resolveSubmittedImageUrl } from "@/lib/huntry/storage/image-urls";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/huntry/storage/image-validation";

const BUCKET = "test-bucket";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function fakeStore() {
  const objects = new Map<string, { contentType: string; token: string }>();
  const store: ImageObjectStore = {
    bucketName: () => BUCKET,
    async save({ path, contentType, token }) {
      objects.set(path, { contentType, token });
    },
    async remove(path) {
      objects.delete(path);
    },
  };

  return { store, objects };
}

describe("sniffImage", () => {
  it("recognises jpeg, png and webp by magic bytes", () => {
    expect(sniffImage(JPEG)?.extension).toBe("jpg");
    expect(sniffImage(PNG)?.extension).toBe("png");
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImage(webp)?.extension).toBe("webp");
  });

  it("rejects svg, html and empty input", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='x'></svg>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("uploadImage / deleteImageByUrl", () => {
  let fake: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    fake = fakeStore();
    setImageObjectStoreForTesting(fake.store);
  });
  afterEach(() => setImageObjectStoreForTesting(null));

  it("stores under the store prefix with a unique path and token URL", async () => {
    const a = await uploadImage({ storeHash: "abc", kind: "sponsor-logo", bytes: PNG });
    const b = await uploadImage({ storeHash: "abc", kind: "sponsor-logo", bytes: PNG });

    expect(a.path).toMatch(/^abc\/sponsor-logo\/[0-9a-f-]+\.png$/);
    expect(a.path).not.toBe(b.path);
    expect(a.url).toContain(`/v0/b/${BUCKET}/o/${encodeURIComponent(a.path)}?alt=media&token=`);
    expect(fake.objects.get(a.path)?.contentType).toBe("image/png");
  });

  it("rejects non-images and oversize files", async () => {
    await expect(uploadImage({ storeHash: "abc", kind: "event-banner", bytes: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(
      ImageUploadError,
    );
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    await expect(uploadImage({ storeHash: "abc", kind: "event-banner", bytes: big })).rejects.toBeInstanceOf(ImageUploadError);
  });

  it("deletes only objects under the caller's own store prefix", async () => {
    const mine = await uploadImage({ storeHash: "abc", kind: "sponsor-logo", bytes: JPEG });
    const theirs = await uploadImage({ storeHash: "xyz", kind: "sponsor-logo", bytes: JPEG });

    await deleteImageByUrl(theirs.url, "abc");
    expect(fake.objects.has(theirs.path)).toBe(true);

    await deleteImageByUrl(mine.url, "abc");
    expect(fake.objects.has(mine.path)).toBe(false);
  });

  it("ignores a malformed percent-encoded URL when deleting", async () => {
    const mine = await uploadImage({ storeHash: "abc", kind: "sponsor-logo", bytes: JPEG });
    const malformed = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/abc%2F%E0%A4%A?alt=media&token=t`;

    await expect(deleteImageByUrl(malformed, "abc")).resolves.toBeUndefined();
    expect(fake.objects.has(mine.path)).toBe(true);
  });
});

describe("resolveSubmittedImageUrl", () => {
  const own = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent("abc/sponsor-logo/1.png")}?alt=media&token=t`;
  const foreign = own.replace("abc%2F", "xyz%2F");
  const base = { current: "/huntry/old.png", fallback: "/huntry/default.png", storeHash: "abc", bucket: BUCKET };

  it("keeps the current value for empty or unchanged input", () => {
    expect(resolveSubmittedImageUrl({ ...base, submitted: "" })).toEqual({ ok: true, url: "/huntry/old.png" });
    expect(resolveSubmittedImageUrl({ ...base, submitted: undefined, current: null })).toEqual({
      ok: true,
      url: "/huntry/default.png",
    });
  });

  it("accepts this store's URL and placeholders, rejects foreign or arbitrary URLs", () => {
    expect(resolveSubmittedImageUrl({ ...base, submitted: own })).toEqual({ ok: true, url: own });
    expect(resolveSubmittedImageUrl({ ...base, submitted: "/huntry/x.png" }).ok).toBe(true);
    expect(resolveSubmittedImageUrl({ ...base, submitted: foreign }).ok).toBe(false);
    expect(resolveSubmittedImageUrl({ ...base, submitted: "https://evil.example/a.png" }).ok).toBe(false);
    expect(resolveSubmittedImageUrl({ ...base, submitted: "//evil.example/a.png" }).ok).toBe(false);
    expect(resolveSubmittedImageUrl({ ...base, submitted: own, bucket: undefined }).ok).toBe(false);
  });

  it("parseOwnedImagePath returns the decoded object path", () => {
    expect(parseOwnedImagePath(own, BUCKET, "abc")).toBe("abc/sponsor-logo/1.png");
    expect(parseOwnedImagePath(own, BUCKET, "xyz")).toBeNull();
  });

  it("treats a malformed percent-encoded path as not owned instead of throwing", () => {
    // Passes the prefix check and new URL(), but decodeURIComponent rejects the truncated escape.
    const malformed = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/abc%2F%E0%A4%A?alt=media&token=t`;

    expect(parseOwnedImagePath(malformed, BUCKET, "abc")).toBeNull();
    expect(resolveSubmittedImageUrl({ ...base, submitted: malformed }).ok).toBe(false);
  });
});
