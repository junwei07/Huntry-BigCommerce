import { describe, expect, it } from "vitest";
import { APP_EXTENSION_INPUT } from "@/lib/huntry/app-extension-gql";

// BigCommerce's CreateAppExtensionInput requires context, label, model and url
// (all non-null). A missing `model` was only caught by a live reinstall, so
// this guards the input shape against the next edit dropping a field.
describe("APP_EXTENSION_INPUT", () => {
  it("sets every field BigCommerce requires", () => {
    expect(APP_EXTENSION_INPUT.context).toBe("LINK");
    expect(APP_EXTENSION_INPUT.model).toBeTruthy();
    expect(APP_EXTENSION_INPUT.url).toBeTruthy();
    expect(APP_EXTENSION_INPUT.label.defaultValue).toBeTruthy();
    expect(Array.isArray(APP_EXTENSION_INPUT.label.locales)).toBe(true);
  });

  it("uses a model BigCommerce accepts", () => {
    expect(["CATEGORIES", "CUSTOMERS", "ORDERS", "PRODUCTS", "PRODUCT_DESCRIPTION"]).toContain(
      APP_EXTENSION_INPUT.model,
    );
  });

  it("is a plain /huntry path carrying BigCommerce's ${id} template as a path segment", () => {
    expect(APP_EXTENSION_INPUT.url).toMatch(/^\/huntry(\/[\w-]+)*\/\$\{id\}(\/[\w-]+)*$/);
    expect(APP_EXTENSION_INPUT.url.length).toBeLessThanOrEqual(255);
  });

  it("has no query string (BigCommerce rejects it as incorrectly formatted)", () => {
    expect(APP_EXTENSION_INPUT.url).not.toContain("?");
  });
});
