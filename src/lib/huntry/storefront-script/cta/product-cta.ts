import { StorefrontCtaData } from "../types";
import { injectCtaStyles } from "./header-banner";
import {
  BRAND_WORD,
  DEFAULT_PRODUCT_DESCRIPTION,
  DEFAULT_PRODUCT_TITLE,
  HUNTRY_PAGE_PATH,
  parseProductId,
  productHasActiveReward,
} from "./model";

// The product-page CTA (BC-HUN-038): a port of huntry_render_product_cta in
// the WordPress plugin. Stencil has no template hook to render into, so this
// finds the main product's add-to-cart form in the DOM. That is inherently
// theme-coupled (docs/MIGRATION.md §4): a theme that renames these hooks shows
// no CTA, never a wrong one.
const PRODUCT_FORM = 'form[data-cart-item-add]';
const PRODUCT_ID_INPUT = 'input[name="product_id"]';
const FALLBACK_ANCHOR = ".productView-info, [data-product-details]";

// Category and search pages also contain add-to-cart-like forms (quick view),
// so a page only counts as a product page when it says so itself.
export function isProductPage(): boolean {
  return Boolean(
    document.querySelector('meta[property="og:type"][content="product"]') ||
      document.querySelector('[itemtype*="schema.org/Product"]'),
  );
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  node.className = className;

  if (text !== undefined) node.textContent = text;

  return node;
}

function buildCta(data: StorefrontCtaData, productId: number): HTMLElement {
  const root = element("div", "huntry-product-cta");
  const content = element("div", "huntry-product-cta__content");
  const text = element("div", "huntry-product-cta__text");
  const titleRow = element("div", "huntry-product-cta__text-container");
  const button = element("a", "huntry-product-cta__button", "Explore Hunts");

  root.dataset.huntryCta = "product";

  // A custom title replaces the whole default title and brand word.
  if (data.productCta.title) {
    titleRow.appendChild(element("strong", "huntry-product-cta__title", data.productCta.title));
  } else {
    titleRow.appendChild(element("strong", "huntry-product-cta__title", DEFAULT_PRODUCT_TITLE.trim()));
    titleRow.appendChild(element("span", "huntry-product-cta__text-orange", BRAND_WORD));
  }

  text.appendChild(titleRow);
  text.appendChild(
    element("span", "huntry-product-cta__description", data.productCta.description || DEFAULT_PRODUCT_DESCRIPTION),
  );

  button.href = HUNTRY_PAGE_PATH;
  button.dataset.productId = String(productId);

  content.appendChild(text);
  content.appendChild(button);
  root.appendChild(content);

  return root;
}

// Shows the CTA under the main product's add-to-cart form when a live hunt
// discounts that product. Does nothing on any other page.
export function mountProductCta(data: StorefrontCtaData): void {
  if (document.querySelector('[data-huntry-cta="product"]') || !isProductPage()) return;

  const form = document.querySelector<HTMLElement>(PRODUCT_FORM);
  const productId = parseProductId(form?.querySelector<HTMLInputElement>(PRODUCT_ID_INPUT)?.value);

  if (productId === null || !productHasActiveReward(data, productId)) return;

  const anchor = form ?? document.querySelector<HTMLElement>(FALLBACK_ANCHOR);

  if (!anchor?.parentNode) return;

  injectCtaStyles();
  anchor.parentNode.insertBefore(buildCta(data, productId), anchor.nextSibling);
}
