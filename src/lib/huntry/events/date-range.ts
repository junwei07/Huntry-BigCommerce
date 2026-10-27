const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

// Date-only on purpose: cached server components format in the server's
// timezone, so a time of day would be wrong for the merchant.
export function formatDateRange(startsAt: Date | null, endsAt: Date | null): string {
  if (!startsAt) {
    return "Not scheduled";
  }

  if (!endsAt) {
    return dateFormatter.format(startsAt);
  }

  return `${dateFormatter.format(startsAt)} — ${dateFormatter.format(endsAt)}`;
}
