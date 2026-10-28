import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for createHuntrySponsor: mock-based (unlike the
// events/rewards action tests) because only the action's own orchestration is
// under test, not the repository.

const isAuthorizedForStore = vi.hoisted(() => vi.fn());
const createSponsor = vi.hoisted(() => vi.fn());
const resolveImageField = vi.hoisted(() => vi.fn());
const updateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ updateTag }));
vi.mock("@/lib/session/is-authorized-for-store", () => ({
  isAuthorizedForStore,
  NOT_AUTHORIZED_FOR_STORE_MESSAGE: "Not authorized for this store.",
}));
vi.mock("@/lib/huntry/sponsors/sponsors-api", () => ({ createSponsor }));
vi.mock("@/lib/huntry/storage/resolve-image-field", () => ({
  INVALID_IMAGE_MESSAGE: "That image was not uploaded for this store. Upload it again.",
  resolveImageField,
}));
vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

const INPUT = {
  name: "Acme",
  instagramUrl: "",
  facebookUrl: "https://facebook.com/acme",
  websiteUrl: "",
  location: "",
  logoUrl: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedForStore.mockResolvedValue(true);
  resolveImageField.mockReturnValue({ ok: true, url: "/logo.png" });
  createSponsor.mockResolvedValue({ id: 7, name: "Acme" });
});

async function run(input = INPUT) {
  const { createHuntrySponsor } = await import("@/app/store/[storeHash]/huntry/sponsors/actions");

  return createHuntrySponsor(input, "store-a");
}

describe("createHuntrySponsor", () => {
  it("refuses a store the session is not linked to, before touching anything", async () => {
    isAuthorizedForStore.mockResolvedValue(false);

    await expect(run()).resolves.toEqual({ success: false, message: "Not authorized for this store." });
    expect(createSponsor).not.toHaveBeenCalled();
  });

  it("returns the first validation message", async () => {
    await expect(run({ ...INPUT, name: "" })).resolves.toEqual({ success: false, message: "Name is required." });
    expect(createSponsor).not.toHaveBeenCalled();
  });

  it("rejects an image that was not uploaded for this store", async () => {
    resolveImageField.mockReturnValue({ ok: false });

    await expect(run()).resolves.toEqual({
      success: false,
      message: "That image was not uploaded for this store. Upload it again.",
    });
  });

  it("creates the sponsor, turns blank fields into null and invalidates its cache tags", async () => {
    await expect(run()).resolves.toEqual({ success: true, message: 'Sponsor "Acme" created.' });

    expect(createSponsor).toHaveBeenCalledWith(
      {
        name: "Acme",
        logoUrl: "/logo.png",
        instagramUrl: null,
        facebookUrl: "https://facebook.com/acme",
        websiteUrl: null,
        location: null,
      },
      "store-a",
    );
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:list");
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:7");
  });

  it("turns an unexpected error into the generic message", async () => {
    createSponsor.mockRejectedValue(new Error("db password leaked"));

    await expect(run()).resolves.toEqual({ success: false, message: "Failed to create the sponsor." });
  });
});
