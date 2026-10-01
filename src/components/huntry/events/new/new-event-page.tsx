import { Box } from "@bigcommerce/big-design";
import { NewEventForm } from "@/components/huntry/events/new/new-event-form";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

export function NewEventPage() {
  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <NewEventForm />
    </Box>
  );
}
