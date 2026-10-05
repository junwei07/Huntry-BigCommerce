type RawSearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: RawSearchParams, key: string): string | undefined {
  const value = searchParams[key];

  return Array.isArray(value) ? value[0] : value;
}

export function parseSelectedEventId(searchParams: RawSearchParams): number | null {
  const eventIdParam = getParam(searchParams, "eventId");
  const eventId = eventIdParam ? Number(eventIdParam) : NaN;

  return Number.isInteger(eventId) ? eventId : null;
}

export function buildMapSearchParams(eventId: number | null): URLSearchParams {
  const params = new URLSearchParams();

  if (eventId !== null) {
    params.set("eventId", String(eventId));
  }

  return params;
}
