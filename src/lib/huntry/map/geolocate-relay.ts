// Shared between geolocate-relay-view.tsx (the popup that posts this
// message) and map-placement-view.tsx (the opener that listens for it) so
// both sides agree on the exact message shape without duplicating literals.
export const GEOLOCATE_RELAY_MESSAGE_SOURCE = "huntry-geolocate";

export type GeolocateRelayMessage =
  | { source: typeof GEOLOCATE_RELAY_MESSAGE_SOURCE; status: "success"; lat: number; lng: number }
  | { source: typeof GEOLOCATE_RELAY_MESSAGE_SOURCE; status: "error"; message: string };

export function isGeolocateRelayMessage(data: unknown): data is GeolocateRelayMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const message = data as { source?: unknown; status?: unknown; lat?: unknown; lng?: unknown };

  if (message.source !== GEOLOCATE_RELAY_MESSAGE_SOURCE) {
    return false;
  }

  if (message.status === "error") {
    return true;
  }

  return message.status === "success" && typeof message.lat === "number" && typeof message.lng === "number";
}

// Chrome's PERMISSION_DENIED message when the embedding <iframe> lacks
// allow="geolocation" ("Geolocation has been disabled in this document by
// permissions policy."). Lets browsers without the policy introspection API
// still tell a frame block apart from the user's own block.
export function isGeolocationPolicyError(error: GeolocationPositionError): boolean {
  return error.code === error.PERMISSION_DENIED && /permissions? policy|disabled in this document/i.test(error.message);
}

type PermissionsPolicyDocument = Document & {
  permissionsPolicy?: { allowsFeature(feature: string): boolean };
  featurePolicy?: { allowsFeature(feature: string): boolean };
};

// Whether the browser says this frame may use geolocation at all.
// false → the embedding <iframe> lacks allow="geolocation" (the call would be
// rejected with no prompt); true → a prompt can appear in this frame;
// null → browser has no Permissions Policy introspection (Firefox/Safari).
export function isGeolocationAllowedInFrame(): boolean | null {
  const doc = document as PermissionsPolicyDocument;
  const policy = doc.permissionsPolicy ?? doc.featurePolicy;

  return policy ? policy.allowsFeature("geolocation") : null;
}
