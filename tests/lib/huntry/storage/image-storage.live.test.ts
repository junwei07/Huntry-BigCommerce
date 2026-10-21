import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deleteImageByUrl, uploadImage } from "@/lib/huntry/storage/image-storage";

// Opt-in against the real dedicated bucket (needs ADC for the huntry-bc-app
// service account and FIREBASE_STORAGE_BUCKET):
//   STORAGE_TEST_LIVE=1 FIREBASE_STORAGE_BUCKET=huntry-bc-images FIREBASE_PROJECT_ID=evms-demo-d1477 \
//     npx vitest run tests/lib/huntry/storage/image-storage.live.test.ts
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe.skipIf(!process.env.STORAGE_TEST_LIVE)("image storage (live bucket)", () => {
  it("uploads, serves through the token URL, and deletes", async () => {
    const storeHash = `livetest${randomUUID().slice(0, 8)}`;
    const { url } = await uploadImage({ storeHash, kind: "sponsor-logo", bytes: new Uint8Array(PNG_1X1) });

    try {
      const response = await fetch(url);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer()).equals(PNG_1X1)).toBe(true);
    } finally {
      await deleteImageByUrl(url, storeHash);
    }

    expect([400, 404]).toContain((await fetch(url)).status);
  }, 30_000);
});
