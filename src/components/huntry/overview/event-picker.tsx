"use client";

import { usePathname, useRouter } from "next/navigation";
import { FormSelect } from "@/components/ui/form-select";
import { useGlobalTransition } from "@/components/ui/global-loading";

export interface EventPickerOption {
  id: number;
  name: string;
  status: string;
}

// WP's "Hunt" picker (huntry_render_overview_page): "Title (status)", switching
// reloads the page for that event. Path is read from the router because the
// Overview is served at both /huntry and /store/<hash>/huntry.
export function EventPicker({ events, selectedEventId }: { events: EventPickerOption[]; selectedEventId: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();

  const options =
    events.length === 0
      ? [{ value: "", content: "No events yet" }]
      : events.map((event) => ({ value: String(event.id), content: `${event.name} (${event.status})` }));

  return (
    <div style={{ maxWidth: "20rem", marginBottom: 16 }}>
      <FormSelect
        disabled={isPending || events.length === 0}
        label="Hunt"
        onOptionChange={(value) => {
          if (value === null || value === "") {
            return;
          }

          startTransition(() => {
            router.push(`${pathname}?eventId=${Number(value)}`);
          });
        }}
        options={options}
        value={selectedEventId === null ? "" : String(selectedEventId)}
      />
    </div>
  );
}
