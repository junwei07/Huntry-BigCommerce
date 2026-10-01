"use client";

import { useEffect, useState, useTransition } from "react";
import { Box, Checkbox, Flex, Input, Small, Text } from "@bigcommerce/big-design";
import { searchRewardProducts } from "@/app/store/[storeHash]/huntry/rewards/actions";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { BcProductSummary } from "@/lib/huntry/rewards/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const SEARCH_DEBOUNCE_MS = 300;

// First multi-select pattern in this app — theme-picker.tsx/
// item-marker-picker.tsx/location-marker-picker.tsx are all single-select
// swatch/radio grids, and no BigDesign multi-select component is used
// anywhere else in src/. Modeled on the WP plugin's own product checklist
// (huntry/includes/rewards/meta-box.php's huntry-product-checklist), but
// with a search box the WP form never had — its full product list was
// rendered inline with no AJAX, which doesn't scale to a real BigCommerce
// catalog. fetchBcProductsForPicker already accepts an optional
// searchTerm (BC-HUN-018), so this is a straightforward use of what's
// already there, not a WP departure that needs its own justification.
//
// Already-selected products that aren't in the current search results
// (e.g. loaded from an existing reward before any search has run) are
// pinned in their own "Selected" list so switching search terms never
// silently drops a prior selection.
export function ProductPicker({
  productIds,
  onChange,
}: {
  productIds: number[];
  onChange: (productIds: number[]) => void;
}) {
  const storeHash = useStoreHash();
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState<BcProductSummary[]>([]);
  const [knownProducts, setKnownProducts] = useState<Map<number, BcProductSummary>>(new Map());
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const handle = setTimeout(() => {
      startTransition(async () => {
        const products = await searchRewardProducts(searchTerm, storeHash);

        setResults(products);
        setKnownProducts((current) => {
          const next = new Map(current);

          for (const product of products) {
            next.set(product.id, product);
          }

          return next;
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [searchTerm, storeHash]);

  const toggleProduct = (productId: number, checked: boolean) => {
    onChange(checked ? [...productIds, productId] : productIds.filter((id) => id !== productId));
  };

  const pinnedSelected = productIds
    .filter((id) => !results.some((product) => product.id === id))
    .map((id) => knownProducts.get(id) ?? { id, name: `Product #${id}`, sku: "" });

  return (
    <Box marginBottom="medium">
      <Input
        label="Products"
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search products by name"
        value={searchTerm}
      />

      {pinnedSelected.length > 0 && (
        <Box marginTop="small">
          <Small marginBottom="xSmall" style={{ color: HUNTRY_COLORS.textMuted }}>
            Selected
          </Small>
          <Flex flexDirection="column" flexGap="0.25rem">
            {pinnedSelected.map((product) => (
              <Checkbox
                checked
                key={product.id}
                label={product.sku ? `${product.name} (${product.sku})` : product.name}
                onChange={() => toggleProduct(product.id, false)}
              />
            ))}
          </Flex>
        </Box>
      )}

      <Box marginTop="small">
        {isPending && <Text style={{ color: HUNTRY_COLORS.textMuted }}>Searching…</Text>}

        {!isPending && results.length === 0 && (
          <Text style={{ color: HUNTRY_COLORS.textMuted }}>No products found.</Text>
        )}

        <Flex flexDirection="column" flexGap="0.25rem">
          {results.map((product) => (
            <Checkbox
              checked={productIds.includes(product.id)}
              key={product.id}
              label={`${product.name} (${product.sku})`}
              onChange={(event) => toggleProduct(product.id, event.target.checked)}
            />
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
