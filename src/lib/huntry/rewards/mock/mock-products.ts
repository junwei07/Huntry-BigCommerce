import { BcProductSummary } from "@/lib/huntry/rewards/types";

// Fixture BigCommerce catalog products for the reward product picker
// (BC-HUN-019) to render in MOCK mode. ids 101/102 are deliberately the same
// ones mock-rewards.ts's "specific"-scope fixture references, so the picker
// can show them as already-selected out of the box.
export const MOCK_PRODUCTS: BcProductSummary[] = [
  { id: 101, name: "Classic Novel Paperback", sku: "BOOK-101" },
  { id: 102, name: "Hardcover Gift Edition", sku: "BOOK-102" },
  { id: 103, name: "Reading Journal", sku: "BOOK-103" },
  { id: 104, name: "Ceramic Coffee Mug", sku: "MUG-104" },
  { id: 105, name: "Travel Tumbler", sku: "MUG-105" },
];
