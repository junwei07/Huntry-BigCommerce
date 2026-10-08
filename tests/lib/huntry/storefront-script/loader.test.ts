import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loader is DOM code and the suite runs in node, so it is driven through a
// minimal stand-in for window/document/fetch. This is the regression test for
// the listing: map-data must be fetched WITHOUT ?event=, because the server
// narrows to that one event and the listing (and the unknown-slug message)
// could not be built from the result.
const EVENT = {
  id: 1,
  name: "Hunt",
  slug: "hunt",
  description: "",
  startsAt: null,
  endsAt: null,
  headerBannerUrl: null,
  markerRadiusMeters: 50,
  maxGrabCount: 0,
  eggClaimCapacity: 1,
  colors: { primaryColor: "#f7a163", successColor: "#5dc564" },
  unclaimedIconUrl: null,
  claimedIconUrl: null,
  locationIconUrl: null,
  locationAnchor: "bottom",
  eggs: [],
};

interface FakeNode {
  tag: string;
  className: string;
  textContent: string;
  dataset: Record<string, string>;
  children: FakeNode[];
  hidden: boolean;
  src?: string;
  appendChild: (child: FakeNode) => FakeNode;
}

function fakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tag,
    className: "",
    textContent: "",
    dataset: {},
    children: [],
    hidden: false,
    appendChild(child) {
      node.children.push(child);

      return child;
    },
  };

  return node;
}

let container: FakeNode;
let headChildren: FakeNode[];
let fetchedUrls: string[];

function setUp(search: string, events: unknown[]) {
  container = fakeNode("div");
  headChildren = [];
  fetchedUrls = [];

  vi.stubGlobal("window", {
    __HUNTRY_STOREFRONT__: { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" },
    location: { search, pathname: "/huntry/" },
    dispatchEvent: vi.fn(),
    setInterval: () => 1,
    clearInterval: vi.fn(),
  });
  vi.stubGlobal("CustomEvent", class {
    constructor(public type: string, public init?: unknown) {}
  });
  vi.stubGlobal("document", {
    readyState: "complete",
    querySelector: (selector: string) => (selector === "[data-huntry-map], #huntry-map" ? container : null),
    createElement: (tag: string) => fakeNode(tag),
    head: { appendChild: (child: FakeNode) => headChildren.push(child) },
    addEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchedUrls.push(url);

      return new Response(JSON.stringify({ events }), { status: 200 });
    }),
  );
}

async function runLoader() {
  vi.resetModules();
  await import("@/lib/huntry/storefront-script/index");
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("storefront loader", () => {
  it("fetches map-data without the slug and loads the map script for a known event", async () => {
    setUp("?event=hunt", [EVENT]);
    await runLoader();

    expect(fetchedUrls).toEqual(["https://app.example.com/api/public/huntry/abc123/map-data"]);
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(true);
  });

  it("renders the listing with no slug and does not load maplibre", async () => {
    setUp("", [EVENT]);
    await runLoader();

    expect(fetchedUrls).toEqual(["https://app.example.com/api/public/huntry/abc123/map-data"]);
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(false);
    expect(container.children.some((child) => child.className === "huntry-cards")).toBe(true);
  });

  it("says no hunts are live on an empty listing", async () => {
    setUp("", []);
    await runLoader();

    expect(container.children[0]?.textContent).toBe("No hunts are live right now. Check back soon!");
  });

  it("reports an unknown slug instead of showing the first event, and loads no map", async () => {
    setUp("?event=typo", [EVENT]);
    await runLoader();

    expect(container.children[0]?.textContent).toContain("We couldn't find that hunt.");
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(false);
  });

  it("shows a message instead of the stale placeholder when map-data fails", async () => {
    setUp("", [EVENT]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    container.textContent = "This page needs scripts and cookies enabled to show Huntry.";
    await runLoader();

    expect(container.textContent).toBe("Huntry couldn't load right now. Please try again later.");
  });
});
