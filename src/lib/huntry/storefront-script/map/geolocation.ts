export type GeolocationProblemKind = "denied" | "unavailable" | "timeout" | "unsupported";

export interface GeolocationProblem {
  kind: GeolocationProblemKind;
  message: string;
}

// GeolocationPositionError.PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT.
// A null code means the browser has no geolocation API at all.
export function describeGeolocationError(code: number | null): GeolocationProblem {
  switch (code) {
    case 1:
      return {
        kind: "denied",
        message:
          "Location access is blocked for this site. Click the icon next to the address bar, allow Location, then reload the page to find eggs near you.",
      };
    case 3:
      return { kind: "timeout", message: "Finding your location is taking too long. Move to an open area and try again." };
    case null:
      return { kind: "unsupported", message: "Your browser does not support location, so nearby eggs can't be detected." };
    default:
      return { kind: "unavailable", message: "Your location is unavailable right now." };
  }
}
