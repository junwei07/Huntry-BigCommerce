// Pure helpers, no SDK imports — shared by the upload route and its tests.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Every place an admin can upload an image to. The kind is the second path
// segment of the stored object (`{storeHash}/{kind}/{uuid}.{ext}`).
export const IMAGE_KINDS = [
  "sponsor-logo",
  "event-banner",
  "featured-banner",
  "featured-logo",
  "reward-image",
] as const;

export type ImageKind = (typeof IMAGE_KINDS)[number];

export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === "string" && (IMAGE_KINDS as readonly string[]).includes(value);
}

export interface SniffedImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
}

// Trusts the bytes, not the browser-supplied MIME type or file name: the
// declared type is attacker-controlled and the bucket serves these back
// verbatim. SVG is deliberately unsupported (script-bearing).
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) {
    return { contentType: "image/png", extension: "png" };
  }

  // "RIFF" ???? "WEBP"
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return { contentType: "image/webp", extension: "webp" };
  }

  return null;
}
