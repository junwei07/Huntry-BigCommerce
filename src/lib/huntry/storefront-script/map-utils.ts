// Ported from huntry/assets/js/huntry-map-utils.js.
const EARTH_RADIUS_METERS = 6371000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

// Great-circle distance between two lat/lng points (haversine formula).
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// "00d 00h 00m 00s", dropping leading zero units. Clamped at zero.
export function formatCountdown(differenceMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(differenceMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number, unit: string) => `${String(value).padStart(2, "0")}${unit}`;
  const parts = [pad(days, "d"), pad(hours, "h"), pad(minutes, "m"), pad(seconds, "s")];

  if (days > 0) return parts.join(" ");
  if (hours > 0) return parts.slice(1).join(" ");
  if (minutes > 0) return parts.slice(2).join(" ");

  return parts[3];
}
