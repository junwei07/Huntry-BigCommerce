// Pure geometry shared by the placement UI (instant feedback) and the Server
// Actions (authoritative) — ports of the plugin's huntry_haversine_meters /
// huntry_is_far_enough (huntry/includes/map/save.php).
export interface Coordinate {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Great-circle distance between two points, in meters.
export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// True if `point` is at least `radiusMeters` from every coordinate in
// `others` — the "don't place two treasures on top of each other" rule.
export function isFarEnough(point: Coordinate, others: Coordinate[], radiusMeters: number): boolean {
  return others.every((other) => haversineMeters(point, other) >= radiusMeters);
}

export function isValidCoordinate({ lat, lng }: Coordinate): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// A closed GeoJSON ring approximating a circle of `radiusMeters` around
// `center` — draws each egg's minimum-spacing keep-out zone on the map.
export function circleRing(center: Coordinate, radiusMeters: number, steps = 48): [number, number][] {
  const angularDistance = radiusMeters / EARTH_RADIUS_METERS;
  const lat = toRadians(center.lat);
  const lng = toRadians(center.lng);
  const ring: [number, number][] = [];

  for (let step = 0; step <= steps; step++) {
    const bearing = (2 * Math.PI * step) / steps;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angularDistance) + Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const pointLng =
      lng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
        Math.cos(angularDistance) - Math.sin(lat) * Math.sin(pointLat),
      );

    ring.push([(pointLng * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }

  return ring;
}
