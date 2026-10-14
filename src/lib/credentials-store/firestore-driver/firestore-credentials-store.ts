import { FieldPath, FieldValue, Firestore } from "firebase-admin/firestore";
import { decrypt, encrypt } from "@/lib/credentials-store/encryption";
import {
  CredentialsStore,
  StoreExtensionRecord,
  StoreRecord,
  StoreStorefrontPageRecord,
  StoreStorefrontScriptRecord,
  StoreUserRecord,
  StoreWebhookRecord,
  UserRecord,
} from "@/lib/credentials-store/types";
import { AppError } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { getFirestoreDb } from "@/lib/firebase/admin";

// Layout (all in the database named by FIRESTORE_DATABASE_ID):
//   stores/{storeHash}                 accessToken (encrypted), scope, adminUserId,
//                                      extensionId, scriptId, storefrontPage, webhooks
//   stores/{storeHash}/storeUsers/{id} the store-user link; a get-by-id answers
//                                      isStoreUserLinked on every authorization
//   users/{userId}                     email, storeHashes (which stores link the user)
//
// Deleting a store deletes its document and its storeUsers docs, never its other
// subcollections: Huntry's own data (Phase 3) lives under the same store
// document and, as with the SQL drivers, outlives an uninstall.
const STORES = "stores";
const STORE_USERS = "storeUsers";
const USERS = "users";

// BigCommerce store hashes are short alphanumeric strings. Public routes pass a
// URL segment straight into the credentials store, and Firestore document ids
// are far less forgiving than a SQL bind parameter (a "/" becomes a path, "." and
// "__x__" are reserved, an empty id throws), so anything else is "no such store"
// rather than an error.
const STORE_HASH_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isValidStoreHash(storeHash: string): boolean {
  return STORE_HASH_PATTERN.test(storeHash);
}

function isValidUserId(userId: number): boolean {
  return Number.isSafeInteger(userId) && userId > 0;
}

function assertValidStoreHash(storeHash: string): void {
  if (!isValidStoreHash(storeHash)) {
    throw new Error("Invalid store hash.");
  }
}

function assertValidUserId(userId: number): void {
  if (!isValidUserId(userId)) {
    throw new Error("Invalid user id.");
  }
}

// Firestore's own errors can carry project and database detail that must never
// reach a client or an unredacted log: every method routes through this, so a raw
// error is logged and never returned as anything but a generic AppError.
async function withDatabaseErrorHandling<T>(context: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    logError(`FirestoreCredentialsStore: ${context}`, error);
    throw new AppError("DATABASE", "A database error occurred.", { cause: error });
  }
}

export class FirestoreCredentialsStore implements CredentialsStore {
  // The client is resolved on first use (the shared process singleton), so
  // constructing a store never touches credentials. A test can inject its own.
  constructor(private readonly injectedDb?: Firestore) {}

  private get db(): Firestore {
    return this.injectedDb ?? getFirestoreDb();
  }

  private storeRef(storeHash: string) {
    return this.db.collection(STORES).doc(storeHash);
  }

  private userRef(userId: number) {
    return this.db.collection(USERS).doc(String(userId));
  }

  // Every setter is an idempotent upsert that touches only its own fields, like
  // the SQL drivers' per-column ON CONFLICT updates, so a re-install keeps the
  // extension, script, page and webhook ids.
  async setStore(store: StoreRecord): Promise<void> {
    return withDatabaseErrorHandling("setStore", async () => {
      assertValidStoreHash(store.storeHash);

      await this.storeRef(store.storeHash).set(
        { accessToken: encrypt(store.accessToken), scope: store.scope, adminUserId: store.adminUserId },
        { merge: true },
      );
    });
  }

  async setUser(user: UserRecord): Promise<void> {
    return withDatabaseErrorHandling("setUser", async () => {
      assertValidUserId(user.userId);

      await this.userRef(user.userId).set({ email: user.email }, { merge: true });
    });
  }

  async setStoreUser(storeUser: StoreUserRecord): Promise<void> {
    return withDatabaseErrorHandling("setStoreUser", async () => {
      assertValidStoreHash(storeUser.storeHash);
      assertValidUserId(storeUser.userId);

      const batch = this.db.batch();

      batch.set(this.storeRef(storeUser.storeHash).collection(STORE_USERS).doc(String(storeUser.userId)), {
        userId: storeUser.userId,
      });
      batch.set(
        this.userRef(storeUser.userId),
        { storeHashes: FieldValue.arrayUnion(storeUser.storeHash) },
        { merge: true },
      );

      await batch.commit();
    });
  }

  // A store only exists once setStore has written its token: a child setter can
  // create the document first, which must not read as an installed store.
  async getStoreToken(storeHash: string): Promise<string | undefined> {
    return withDatabaseErrorHandling("getStoreToken", async () => {
      if (!isValidStoreHash(storeHash)) {
        return undefined;
      }

      const accessToken = (await this.storeRef(storeHash).get()).get("accessToken");

      return typeof accessToken === "string" ? decrypt(accessToken) : undefined;
    });
  }

  async setStoreExtension(storeExtension: StoreExtensionRecord): Promise<void> {
    return withDatabaseErrorHandling("setStoreExtension", async () => {
      assertValidStoreHash(storeExtension.storeHash);

      await this.storeRef(storeExtension.storeHash).set({ extensionId: storeExtension.extensionId }, { merge: true });
    });
  }

  async getStoreExtension(storeHash: string): Promise<string | undefined> {
    return withDatabaseErrorHandling("getStoreExtension", async () => {
      if (!isValidStoreHash(storeHash)) {
        return undefined;
      }

      const extensionId = (await this.storeRef(storeHash).get()).get("extensionId");

      return typeof extensionId === "string" ? extensionId : undefined;
    });
  }

  async setStoreStorefrontScript(storeStorefrontScript: StoreStorefrontScriptRecord): Promise<void> {
    return withDatabaseErrorHandling("setStoreStorefrontScript", async () => {
      assertValidStoreHash(storeStorefrontScript.storeHash);

      await this.storeRef(storeStorefrontScript.storeHash).set(
        { scriptId: storeStorefrontScript.scriptId },
        { merge: true },
      );
    });
  }

  async getStoreStorefrontScript(storeHash: string): Promise<string | undefined> {
    return withDatabaseErrorHandling("getStoreStorefrontScript", async () => {
      if (!isValidStoreHash(storeHash)) {
        return undefined;
      }

      const scriptId = (await this.storeRef(storeHash).get()).get("scriptId");

      return typeof scriptId === "string" ? scriptId : undefined;
    });
  }

  async setStoreStorefrontPage(storeStorefrontPage: StoreStorefrontPageRecord): Promise<void> {
    return withDatabaseErrorHandling("setStoreStorefrontPage", async () => {
      assertValidStoreHash(storeStorefrontPage.storeHash);

      await this.storeRef(storeStorefrontPage.storeHash).set(
        {
          storefrontPage: {
            pageId: storeStorefrontPage.pageId,
            createdByApp: storeStorefrontPage.createdByApp,
          },
        },
        { merge: true },
      );
    });
  }

  async getStoreStorefrontPage(storeHash: string): Promise<StoreStorefrontPageRecord | undefined> {
    return withDatabaseErrorHandling("getStoreStorefrontPage", async () => {
      if (!isValidStoreHash(storeHash)) {
        return undefined;
      }

      const page = (await this.storeRef(storeHash).get()).get("storefrontPage") as
        | { pageId?: unknown; createdByApp?: unknown }
        | undefined;

      if (!page || typeof page.pageId !== "number") {
        return undefined;
      }

      return { storeHash, pageId: page.pageId, createdByApp: Boolean(page.createdByApp) };
    });
  }

  // The scope goes in as a literal map key: webhook scopes contain slashes (and
  // could contain dots), which a dotted field-path string would split.
  async setStoreWebhook(storeWebhook: StoreWebhookRecord): Promise<void> {
    return withDatabaseErrorHandling("setStoreWebhook", async () => {
      assertValidStoreHash(storeWebhook.storeHash);

      await this.storeRef(storeWebhook.storeHash).set(
        { webhooks: { [storeWebhook.scope]: storeWebhook.hookId } },
        { merge: true },
      );
    });
  }

  async getStoreWebhook(storeHash: string, scope: string): Promise<string | undefined> {
    return withDatabaseErrorHandling("getStoreWebhook", async () => {
      if (!isValidStoreHash(storeHash) || scope.length === 0) {
        return undefined;
      }

      const hookId = (await this.storeRef(storeHash).get()).get(new FieldPath("webhooks", scope));

      return typeof hookId === "string" ? hookId : undefined;
    });
  }

  async isStoreUserLinked(storeHash: string, userId: number): Promise<boolean> {
    return withDatabaseErrorHandling("isStoreUserLinked", async () => {
      if (!isValidStoreHash(storeHash) || !isValidUserId(userId)) {
        return false;
      }

      return (await this.storeRef(storeHash).collection(STORE_USERS).doc(String(userId)).get()).exists;
    });
  }

  // One transaction, reads first (a Firestore rule). Removes the store, its
  // links, and every user who is left with no store at all. A missing store is a
  // no-op. Never touches the store's other subcollections (see the layout note).
  async deleteStore(storeHash: string): Promise<void> {
    return withDatabaseErrorHandling("deleteStore", async () => {
      if (!isValidStoreHash(storeHash)) {
        return;
      }

      const storeRef = this.storeRef(storeHash);

      await this.db.runTransaction(async (transaction) => {
        const links = await transaction.get(storeRef.collection(STORE_USERS));
        const userRefs = links.docs.map((link) => this.userRef(Number(link.id)));
        const users = userRefs.length > 0 ? await transaction.getAll(...userRefs) : [];

        for (const link of links.docs) {
          transaction.delete(link.ref);
        }

        transaction.delete(storeRef);

        for (const user of users) {
          if (!user.exists) {
            continue;
          }

          const remaining = ((user.get("storeHashes") as string[] | undefined) ?? []).filter(
            (hash) => hash !== storeHash,
          );

          if (remaining.length === 0) {
            transaction.delete(user.ref);
          } else {
            transaction.update(user.ref, { storeHashes: FieldValue.arrayRemove(storeHash) });
          }
        }
      });
    });
  }

  // Removes one link, then the user when no store links them any more. Like the
  // SQL drivers, that second check runs whether or not the link existed.
  async deleteUser(storeHash: string, userId: number): Promise<void> {
    return withDatabaseErrorHandling("deleteUser", async () => {
      if (!isValidStoreHash(storeHash) || !isValidUserId(userId)) {
        return;
      }

      const linkRef = this.storeRef(storeHash).collection(STORE_USERS).doc(String(userId));
      const userRef = this.userRef(userId);

      await this.db.runTransaction(async (transaction) => {
        const user = await transaction.get(userRef);

        transaction.delete(linkRef);

        if (!user.exists) {
          return;
        }

        const remaining = ((user.get("storeHashes") as string[] | undefined) ?? []).filter(
          (hash) => hash !== storeHash,
        );

        if (remaining.length === 0) {
          transaction.delete(userRef);
        } else {
          transaction.update(userRef, { storeHashes: FieldValue.arrayRemove(storeHash) });
        }
      });
    });
  }
}
