// Shared by reward-card.tsx and reward-list-header.tsx — see
// event-row-grid.ts for why this is a CSS Grid template rather than a Flex
// ratio. No leading thumbnail column (rewards themselves have no logo/
// banner field, unlike events/sponsors) — the Sponsor column's own small
// logo thumbnail is inline within that cell instead, not a separate grid
// column, since it's conditional on the reward having a sponsor at all.
export const REWARD_ROW_GRID_TEMPLATE = "1fr 190px 240px 150px 150px 48px";