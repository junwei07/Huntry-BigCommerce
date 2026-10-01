import { Box } from "@bigcommerce/big-design";
import { NewSponsorForm } from "@/components/huntry/sponsors/new/new-sponsor-form";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

export function NewSponsorPage() {
  return (
    <Box padding="medium" style={{ backgroundColor: HUNTRY_COLORS.background }}>
      <NewSponsorForm />
    </Box>
  );
}
