import { afterEach, describe, expect, it, vi } from "vitest";
import { loginUrl } from "@/lib/huntry/storefront-script/page-mode";

afterEach(() => vi.unstubAllGlobals());

// BigCommerce's own guest redirect looks like /login.php?from=account.php%3Faction%3D:
// a root-relative path with no leading slash, URL-encoded.
describe("loginUrl", () => {
  it("returns to the event map, query string included", () => {
    vi.stubGlobal("window", { location: { pathname: "/huntry/", search: "?event=hunt" } });

    expect(loginUrl()).toBe("/login.php?from=huntry%2F%3Fevent%3Dhunt");
  });

  it("returns to the rewards page", () => {
    vi.stubGlobal("window", { location: { pathname: "/huntry/", search: "?view=rewards" } });

    expect(loginUrl()).toBe("/login.php?from=huntry%2F%3Fview%3Drewards");
  });

  it("handles a path with no query", () => {
    vi.stubGlobal("window", { location: { pathname: "/huntry/", search: "" } });

    expect(loginUrl()).toBe("/login.php?from=huntry%2F");
  });
});
