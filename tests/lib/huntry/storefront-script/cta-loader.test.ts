import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Drives the loader on pages WITHOUT a Huntry container (BC-HUN-038) through a
// minimal stand-in for window/document/fetch, like loader.test.ts. The visual
// result is checked in a real browser; this pins what the loader fetches and
// where it inserts things.
interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  dataset: Record<string, string>;
  children: FakeNode[];
  parentNode: FakeNode | null;
  hidden: boolean;
  value?: string;
  href?: string;
  src?: string;
  style: { setProperty: (name: string, value: string) => void; transform?: string; transition?: string; overflow?: string };
  classList: { toggle: () => void; add: (name: string) => void; remove: (name: string) => void };
  appendChild: (child: FakeNode) => FakeNode;
  append: (...children: Array<FakeNode | string>) => void;
  insertBefore: (child: FakeNode, before: FakeNode | null) => FakeNode;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  addEventListener: () => void;
  querySelector: (selector: string) => FakeNode | null;
  nextSibling: FakeNode | null;
  firstChild: FakeNode | null;
}

function fakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tag,
    className: "",
    textContent: "",
    dataset: {},
    children: [],
    parentNode: null,
    hidden: false,
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);

      return child;
    },
    append(...children) {
      for (const child of children) if (typeof child !== "string") node.appendChild(child);
    },
    insertBefore(child, before) {
      child.parentNode = node;

      const index = before ? node.children.indexOf(before) : -1;

      if (index === -1) node.children.push(child);
      else node.children.splice(index, 0, child);

      return child;
    },
    remove() {
      const siblings = node.parentNode?.children ?? [];

      siblings.splice(siblings.indexOf(node), 1);
    },
    setAttribute() {},
    addEventListener() {},
    querySelector: () => null,
    get nextSibling() {
      const siblings = node.parentNode?.children ?? [];

      return siblings[siblings.indexOf(node) + 1] ?? null;
    },
    get firstChild() {
      return node.children[0] ?? null;
    },
  } as FakeNode;

  return node;
}

const LIVE_EVENT = {
  name: "Summer Hunt",
  slug: "summer",
  startsAt: "2020-01-01T00:00:00Z",
  endsAt: null,
  headerBannerUrl: null,
  primaryColor: "#f7a163",
};

function ctaData(overrides: Record<string, unknown> = {}) {
  return {
    events: [LIVE_EVENT],
    allProducts: false,
    productIds: [42],
    banner: { description: "", logoUrl: "https://app.example.com/huntry-logo.png", imageUrl: "https://app.example.com/b.png" },
    productCta: { title: "", description: "" },
    ...overrides,
  };
}

let body: FakeNode;
let head: FakeNode;
let container: FakeNode;
let fetchedUrls: string[];

function setUp(options: {
  data?: unknown;
  config?: boolean;
  productForm?: { productId: string } | null;
  productPage?: boolean;
  // A Huntry page: the container the loader looks for, plus the URL's query and
  // what map-data and the customer check answer.
  huntryPage?: { search: string; events?: unknown[]; guest?: boolean };
}) {
  body = fakeNode("body");
  head = fakeNode("head");
  container = fakeNode("div");
  fetchedUrls = [];

  const existingChild = fakeNode("div");

  body.appendChild(existingChild);

  const form = fakeNode("form");
  const productInput = fakeNode("input");

  productInput.value = options.productForm?.productId ?? "";
  form.querySelector = (selector) => (selector === 'input[name="product_id"]' ? productInput : null);
  body.appendChild(form);

  vi.stubGlobal("window", {
    __HUNTRY_STOREFRONT__:
      options.config === false ? null : { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" },
    location: { search: options.huntryPage?.search ?? "", hash: "", pathname: options.huntryPage ? "/huntry/" : "/some-product/" },
    addEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setInterval: () => 1,
    clearInterval: vi.fn(),
    setTimeout: () => 1,
  });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    set src(_value: string) {}
  });
  vi.stubGlobal("document", {
    readyState: "complete",
    hidden: false,
    body,
    head: { appendChild: (child: FakeNode) => head.appendChild(child) },
    querySelector: (selector: string) => {
      if (selector === "[data-huntry-map], #huntry-map") return options.huntryPage ? container : null;
      if (selector === "style[data-huntry-cta-css]") return head.children.find((child) => child.tag === "style") ?? null;
      if (selector.startsWith('[data-huntry-cta="')) {
        const marker = selector.slice(18, -2);

        return body.children.find((child) => child.dataset.huntryCta === marker) ?? null;
      }
      if (selector === 'meta[property="og:type"][content="product"]') return options.productPage ? fakeNode("meta") : null;
      if (selector === "form[data-cart-item-add]") return options.productForm ? form : null;

      return null;
    },
    createElement: (tag: string) => fakeNode(tag),
    createComment: () => fakeNode("#comment"),
    createTextNode: (text: string) => Object.assign(fakeNode("#text"), { textContent: text }),
    addEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchedUrls.push(url);

      if (url.endsWith("/map-data")) {
        return new Response(JSON.stringify({ events: options.huntryPage?.events ?? [] }), { status: 200 });
      }

      if (url.startsWith("/customer/current.jwt")) {
        return options.huntryPage?.guest ? new Response("", { status: 404 }) : new Response("a.jwt.token", { status: 200 });
      }

      return new Response(JSON.stringify(options.data ?? ctaData()), { status: 200 });
    }),
  );

  return { existingChild, form };
}

async function runLoader() {
  vi.resetModules();
  await import("@/lib/huntry/storefront-script/index");
  await new Promise((resolve) => setTimeout(resolve, 20));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("storefront loader on pages without a Huntry container", () => {
  it("fetches only cta-data, never map-data, and puts the banner first in the body", async () => {
    const { existingChild } = setUp({});

    await runLoader();

    expect(fetchedUrls).toEqual(["https://app.example.com/api/public/huntry/abc123/cta-data"]);
    expect(body.children[0].dataset.huntryCta).toBe("header");
    expect(body.children[0]).not.toBe(existingChild);
  });

  it("draws nothing when no hunt is live", async () => {
    setUp({ data: ctaData({ events: [] }) });
    await runLoader();

    expect(body.children.some((child) => child.dataset.huntryCta)).toBe(false);
  });

  it("draws nothing and does not throw when cta-data fails", async () => {
    setUp({});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await runLoader();

    expect(body.children.some((child) => child.dataset.huntryCta)).toBe(false);
  });

  it("stays silent without a config on a non-Huntry page", async () => {
    setUp({ config: false });
    await runLoader();

    expect(fetchedUrls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds the product CTA after the add-to-cart form for a covered product", async () => {
    const { form } = setUp({ productPage: true, productForm: { productId: "42" } });

    await runLoader();

    const cta = body.children.find((child) => child.dataset.huntryCta === "product");

    expect(cta).toBeDefined();
    expect(body.children.indexOf(cta as FakeNode)).toBe(body.children.indexOf(form) + 1);
  });

  it("skips an uncovered product, a non-product page and a malformed id", async () => {
    for (const options of [
      { productPage: true, productForm: { productId: "7" } },
      { productPage: false, productForm: { productId: "42" } },
      { productPage: true, productForm: { productId: "4x2" } },
    ]) {
      setUp(options);
      await runLoader();

      expect(body.children.some((child) => child.dataset.huntryCta === "product")).toBe(false);
    }
  });
});

// The plugin keeps the banner on the event-cards listing and My Account and
// drops it only on the hunt map (huntry/includes/frontend/cta.php:80-85).
describe("storefront loader on the Huntry page", () => {
  const MAP_EVENT = { ...LIVE_EVENT, id: 1, description: "", eggs: [], colors: null };

  it("shows the header banner on the hunts list", async () => {
    setUp({ huntryPage: { search: "", events: [MAP_EVENT] } });
    await runLoader();

    expect(fetchedUrls[0]).toBe("https://app.example.com/api/public/huntry/abc123/map-data");
    expect(fetchedUrls).toContain("https://app.example.com/api/public/huntry/abc123/cta-data");
    expect(body.children[0].dataset.huntryCta).toBe("header");
  });

  it("shows it on My Rewards too", async () => {
    setUp({ huntryPage: { search: "?view=rewards", events: [MAP_EVENT] } });
    await runLoader();

    expect(body.children[0].dataset.huntryCta).toBe("header");
  });

  it("does not show it on a hunt map", async () => {
    setUp({ huntryPage: { search: "?event=summer", events: [MAP_EVENT] } });
    await runLoader();

    expect(fetchedUrls.some((url) => url.endsWith("/cta-data"))).toBe(false);
    expect(body.children.some((child) => child.dataset.huntryCta)).toBe(false);
  });

  it("does not show it on the guest login shell of a hunt map either", async () => {
    setUp({ huntryPage: { search: "?event=summer", events: [MAP_EVENT], guest: true } });
    await runLoader();

    // The shell and popup were really built (a throw would land in console.error).
    expect(console.error).not.toHaveBeenCalled();

    expect(fetchedUrls.some((url) => url.endsWith("/cta-data"))).toBe(false);
    expect(body.children.some((child) => child.dataset.huntryCta)).toBe(false);
  });
});
