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
  href?: string;
  style: { overflow?: string; background?: string; setProperty: (name: string, value: string) => void };
  classList: { add: (name: string) => void; remove: (name: string) => void };
  appendChild: (child: FakeNode) => FakeNode;
  append: (...children: (FakeNode | string)[]) => void;
  setAttribute: (name: string, value: string) => void;
}

function fakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tag,
    className: "",
    textContent: "",
    dataset: {},
    children: [],
    hidden: false,
    style: { setProperty() {} },
    classList: { add() {}, remove() {} },
    appendChild(child) {
      node.children.push(child);

      return child;
    },
    append(...children) {
      for (const child of children) {
        if (typeof child !== "string") node.children.push(child);
      }
    },
    setAttribute() {},
  };

  return node;
}

let container: FakeNode;
let headChildren: FakeNode[];
let fetchedUrls: string[];
let body: FakeNode;

const JWT_URL = "/customer/current.jwt?app_client_id=client-1";

// `guest` makes BigCommerce's current.jwt answer 404, as it does when no
// customer is signed in.
// `huntFull` is the player-status answer for a signed-in customer.
function setUp(search: string, events: unknown[], guest = false, huntFull = false) {
  container = fakeNode("div");
  body = fakeNode("body");
  headChildren = [];
  fetchedUrls = [];

  vi.stubGlobal("window", {
    __HUNTRY_STOREFRONT__: { appOrigin: "https://app.example.com", storeHash: "abc123", clientId: "client-1" },
    location: { search, hash: "", pathname: "/huntry/" },
    addEventListener: vi.fn(),
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
    createComment: () => fakeNode("#comment"),
    head: { appendChild: (child: FakeNode) => headChildren.push(child) },
    body,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetchedUrls.push(url);

      if (url === JWT_URL) {
        return guest ? new Response("", { status: 404 }) : new Response("a.jwt.token", { status: 200 });
      }

      if (url.endsWith("/player-status")) {
        return new Response(JSON.stringify({ full: huntFull }), { status: 200 });
      }

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

    expect(fetchedUrls.slice(0, 2)).toEqual(["https://app.example.com/api/public/huntry/abc123/map-data", JWT_URL]);
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(true);
  });

  it("gates a live event's map behind login: no map script, a login prompt that returns to the event", async () => {
    setUp("?event=hunt", [EVENT], true);
    await runLoader();

    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(false);

    // The hunt shell (title bar with a back link to the listing) sits under the popup.
    const [header] = container.children;

    expect(body.children[0]).toBe(container);
    expect(header?.className).toBe("huntry-fullscreen__header");
    expect(header?.children[0]?.href).toBe("/huntry/");
    expect(header?.children[1]?.textContent).toBe("Hunt");

    const overlay = body.children[1];
    const [message, login] = overlay?.children[0]?.children[0]?.children ?? [];

    expect(overlay?.className).toBe("huntry-claim-overlay");
    expect(message?.textContent).toBe("Log in or create an account to join the hunt.");
    expect(login?.href).toBe("/login.php?from=huntry%2F%3Fevent%3Dhunt");
  });

  it("blocks a full hunt for a new player: no map script, a back-to-events button", async () => {
    setUp("?event=hunt", [EVENT], false, true);
    await runLoader();

    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(false);

    const [header] = container.children;

    expect(header?.className).toBe("huntry-fullscreen__header");
    expect(header?.children[0]?.href).toBe("/huntry/");

    const overlay = body.children[1];
    const [icon, title, message, back] = overlay?.children[0]?.children[0]?.children ?? [];

    expect(overlay?.className).toBe("huntry-claim-overlay");
    expect(icon?.textContent).toBe("🙁");
    expect(title?.textContent).toBe("This hunt is full");
    expect(message?.textContent).toContain("maximum number of players");
    expect(back?.textContent).toBe("Back to events");
    expect(back?.href).toBe("/huntry/");
  });

  it("asks player-status with the JWT and the event id", async () => {
    setUp("?event=hunt", [EVENT]);
    await runLoader();

    expect(fetchedUrls).toContain("https://app.example.com/api/public/huntry/abc123/player-status");
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(true);
  });

  it("still loads the map when the player-status check fails", async () => {
    setUp("?event=hunt", [EVENT]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === JWT_URL) return new Response("a.jwt.token", { status: 200 });
        if (url.endsWith("/player-status")) return new Response("boom", { status: 500 });

        return new Response(JSON.stringify({ events: [EVENT] }), { status: 200 });
      }),
    );
    await runLoader();

    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(true);
  });

  it("still loads the map when the login check itself fails", async () => {
    setUp("?event=hunt", [EVENT]);
    const fetchMock = vi.fn(async (url: string) => {
      if (url === JWT_URL) throw new Error("offline");

      return new Response(JSON.stringify({ events: [EVENT] }), { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);
    await runLoader();

    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(true);
  });

  it("does not check login for the listing", async () => {
    setUp("", [EVENT], true);
    await runLoader();

    expect(fetchedUrls).not.toContain(JWT_URL);
  });

  it("renders the listing with no slug and does not load maplibre", async () => {
    setUp("", [EVENT]);
    await runLoader();

    // map-data first; the header banner's cta-data request follows the render.
    expect(fetchedUrls[0]).toBe("https://app.example.com/api/public/huntry/abc123/map-data");
    expect(headChildren.some((node) => node.src?.endsWith("/storefront-map.js"))).toBe(false);
    expect(container.children.some((child) => child.className === "huntry-cards")).toBe(true);
  });

  it("says no hunts are live on an empty listing", async () => {
    setUp("", []);
    await runLoader();

    expect(container.children.find((child) => child.className === "huntry-cards-message")?.textContent).toBe(
      "No hunts are live right now. Check back soon!",
    );
    // The Hunts / My Rewards tabs sit above it.
    expect(container.children[0]?.className).toBe("huntry-page-nav");
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
