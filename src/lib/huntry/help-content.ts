// Per-tab help text for the "?" dialog. Ported from the plugin's
// huntry_get_admin_info_content() (huntry/includes/admin/index.php), keyed by
// the MainNav item ids (src/components/layout/main-nav.tsx). The plugin's
// Settings tab has no BigCommerce counterpart, and Featured is reworded to
// match this app's header-banner / product-page-CTA form.
export interface HelpContent {
  title: string;
  description: string;
  steps: string[];
}

export const HELP_CONTENT: Record<string, HelpContent> = {
  huntry: {
    title: "Overview",
    description:
      "A snapshot of one event's hunt: its map, recent claims, and leaderboard.",
    steps: [
      "Pick an event from the dropdown.",
      "Review its map, stat cards, and the Game activity feed.",
      "Check the leaderboard for the top players.",
    ],
  },
  map: {
    title: "Map",
    description:
      'Place reward "eggs" on the map for an event, and manage the ones already placed.',
    steps: [
      "Select an event.",
      'Click "Place Item", then tap the map to drop an egg.',
      "Name it and pick which reward it unlocks.",
      "Use an existing egg's menu to edit, force-claim, or delete it.",
    ],
  },
  events: {
    title: "Events",
    description:
      "Create and manage your custom events",
    steps: [
      "Add or edit an event.",
      "Set its start/end time and description.",
      "Upload a header banner and choose its markers/theme colour.",
    ],
  },
  rewards: {
    title: "Rewards",
    description:
      "Create the rewards (gift cards/discounts) that get placed as eggs on the map.",
    steps: [
      "Add a reward with its discount code and value.",
      "Choose which products it applies to, and optionally a sponsor.",
      "Set how many eggs it can have, then place them on the Map tab.",
    ],
  },
  sponsors: {
    title: "Sponsors",
    description: "Manage the sponsor brands that can be linked to a reward.",
    steps: [
      "Add a sponsor's name, logo, and links.",
      "Assign it to a reward from the Rewards tab.",
    ],
  },
  featured: {
    title: "Featured",
    description:
      "Customize the storefront header banner and the rewards banner shown on product pages.",
    steps: [
      "Set the banner description, button logo, and banner image.",
      "Set the title and description of the product page CTA.",
      "Save — live events appear in the storefront header banner.",
    ],
  },
};
