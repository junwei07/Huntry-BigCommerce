import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Layout-only regression with no browser in the suite: Stencil floats the
// add-to-cart block and clears it only after the whole options container, so
// the product CTA has to clear it itself or the button lands inside the box.
const css = readFileSync(join(process.cwd(), "src/lib/huntry/storefront-script/cta/cta.css"), "utf8");

describe("cta.css", () => {
  it("makes the product CTA clear the theme's floated add-to-cart button", () => {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const own = rules.filter(([, selector]) => selector.trim() === ".huntry-product-cta");

    expect(own.some(([, , body]) => /clear:\s*both/.test(body))).toBe(true);
  });
});
