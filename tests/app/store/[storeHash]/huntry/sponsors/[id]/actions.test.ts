import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for updateHuntrySponsor / deleteHuntrySponsor.

const isAuthorizedForStore = vi.hoisted(() => vi.fn());
const fetchSponsorUncached = vi.hoisted(() => vi.fn());
const updateSponsor = vi.hoisted(() => vi.fn());
const deleteSponsor = vi.hoisted(() => vi.fn());
const resolveImageField = vi.hoisted(() => vi.fn());
const deleteImageByUrl = vi.hoisted(() => vi.fn());
const updateTag = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ updateTag }));
vi.mock("@/lib/session/is-authorized-for-store", () => ({
  isAuthorizedForStore,
  NOT_AUTHORIZED_FOR_STORE_MESSAGE: "Not authorized for this store.",
}));
vi.mock("@/lib/huntry/sponsors/sponsors-api", () => ({ fetchSponsorUncached, updateSponsor, deleteSponsor }));
vi.mock("@/lib/huntry/storage/resolve-image-field", () => ({
  INVALID_IMAGE_MESSAGE: "That image was not uploaded for this store. Upload it again.",
  resolveImageField,
}));
vi.mock("@/lib/huntry/storage/image-storage", () => ({ deleteImageByUrl }));
vi.mock("@/lib/bc-api-client/resolve-store-credentials", () => ({ resolveStoreHash: (hash: string) => hash }));
vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

const NOT_FOUND =
  "That sponsor no longer exists. It may have been deleted — reload the page to see the current list.";

const INPUT = {
  name: "Acme",
  instagramUrl: "",
  facebookUrl: "",
  websiteUrl: "",
  location: "Sydney",
  logoUrl: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  isAuthorizedForStore.mockResolvedValue(true);
  fetchSponsorUncached.mockResolvedValue({ id: 7, name: "Old", logoUrl: "/old.png" });
  resolveImageField.mockReturnValue({ ok: true, url: "/new.png" });
  updateSponsor.mockResolvedValue({ id: 7, name: "Acme" });
  deleteSponsor.mockResolvedValue(true);
});

async function actions() {
  return import("@/app/store/[storeHash]/huntry/sponsors/[id]/actions");
}

describe("updateHuntrySponsor", () => {
  it("refuses an unauthorized store", async () => {
    isAuthorizedForStore.mockResolvedValue(false);

    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({
      success: false,
      message: "Not authorized for this store.",
    });
    expect(updateSponsor).not.toHaveBeenCalled();
  });

  it("returns the first validation message", async () => {
    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, { ...INPUT, name: "" }, "store-a")).resolves.toEqual({
      success: false,
      message: "Name is required.",
    });
  });

  it("reports a sponsor that was deleted before the edit", async () => {
    fetchSponsorUncached.mockResolvedValue(undefined);

    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({ success: false, message: NOT_FOUND });
  });

  it("rejects an image that was not uploaded for this store", async () => {
    resolveImageField.mockReturnValue({ ok: false });

    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({
      success: false,
      message: "That image was not uploaded for this store. Upload it again.",
    });
  });

  it("reports a sponsor that vanished during the write", async () => {
    updateSponsor.mockResolvedValue(undefined);

    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({ success: false, message: NOT_FOUND });
  });

  it("updates, deletes the replaced logo and invalidates the cache tags", async () => {
    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({
      success: true,
      message: 'Sponsor "Acme" updated.',
    });
    expect(deleteImageByUrl).toHaveBeenCalledWith("/old.png", "store-a");
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:list");
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:7");
  });

  it("keeps the old logo file when the logo did not change", async () => {
    resolveImageField.mockReturnValue({ ok: true, url: "/old.png" });

    const { updateHuntrySponsor } = await actions();

    await updateHuntrySponsor(7, INPUT, "store-a");

    expect(deleteImageByUrl).not.toHaveBeenCalled();
  });

  it("turns an unexpected error into the generic message", async () => {
    updateSponsor.mockRejectedValue(new Error("boom"));

    const { updateHuntrySponsor } = await actions();

    await expect(updateHuntrySponsor(7, INPUT, "store-a")).resolves.toEqual({
      success: false,
      message: "Failed to update the sponsor.",
    });
  });
});

describe("deleteHuntrySponsor", () => {
  it("refuses an unauthorized store", async () => {
    isAuthorizedForStore.mockResolvedValue(false);

    const { deleteHuntrySponsor } = await actions();

    await expect(deleteHuntrySponsor(7, "store-a")).resolves.toEqual({
      success: false,
      message: "Not authorized for this store.",
    });
    expect(deleteSponsor).not.toHaveBeenCalled();
  });

  it("reports a sponsor that is already gone", async () => {
    deleteSponsor.mockResolvedValue(false);

    const { deleteHuntrySponsor } = await actions();

    await expect(deleteHuntrySponsor(7, "store-a")).resolves.toEqual({ success: false, message: NOT_FOUND });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it("deletes the sponsor and its logo, then invalidates the cache tags", async () => {
    const { deleteHuntrySponsor } = await actions();

    await expect(deleteHuntrySponsor(7, "store-a")).resolves.toEqual({ success: true, message: "Sponsor deleted." });
    expect(deleteImageByUrl).toHaveBeenCalledWith("/old.png", "store-a");
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:list");
    expect(updateTag).toHaveBeenCalledWith("huntry-sponsor:7");
  });

  it("turns an unexpected error into the generic message and skips the cache tags", async () => {
    deleteSponsor.mockRejectedValue(new Error("boom"));

    const { deleteHuntrySponsor } = await actions();

    await expect(deleteHuntrySponsor(7, "store-a")).resolves.toEqual({
      success: false,
      message: "Failed to delete the sponsor.",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
