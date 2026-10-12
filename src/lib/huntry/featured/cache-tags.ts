// One row per store, so one tag per store. Mirrors sponsors/cache-tags.ts.
export function storefrontSettingsTag(storeHash: string): string {
  return `huntry-storefront-settings:${storeHash}`;
}
