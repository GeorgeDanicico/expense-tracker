import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn(), getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin-client", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }));

import { supabaseAvatarRepository as avatars } from "@/lib/supabase/repositories/avatars";

const SAVE_ERROR = new Error("Unable to save your picture. Please try again.");
const REMOVE_ERROR = new Error("Unable to remove your picture. Please try again.");

const user = { id: "10000000-0000-4000-8000-000000000071", email: "owner@example.test" };
const otherUser = { id: "10000000-0000-4000-8000-000000000072", email: "other@example.test" };
const oldPath = `${user.id}/20000000-0000-4000-8000-000000000071.webp`;
const otherPath = `${otherUser.id}/20000000-0000-4000-8000-000000000072.webp`;
const webp = new Uint8Array([82, 73, 70, 70]);
const newKey = new RegExp(`^${user.id}/[0-9a-f-]{36}\\.webp$`);

type Profile = { id: string; avatar_path: string | null };

/** The request client: acts as the caller, through their session. */
function useRequestClient(profiles: Profile[] = [], options?: FakeSupabaseOptions) {
  const database = fakeSupabase({ profiles }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

/** The secret-key client, seeded with both users' profiles and pictures. */
function useAdminClient(profiles: Profile[], options: FakeSupabaseOptions = {}) {
  const database = fakeSupabase(
    { profiles },
    { objects: { avatars: { [oldPath]: new Uint8Array([1]), [otherPath]: new Uint8Array([2]) } }, ...options },
  );
  mocks.createAdminClient.mockReturnValue(database.client);
  return database;
}

function signedIn(caller: { id: string; email: string } | null = user) {
  mocks.getAuthenticatedUser.mockResolvedValue(caller);
}

describe("Supabase avatar repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    signedIn();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("getPath", () => {
    it("reads the user's avatar key with the request client", async () => {
      const { queries } = useRequestClient([{ id: otherUser.id, avatar_path: otherPath }, { id: user.id, avatar_path: oldPath }]);

      expect(await avatars.getPath(user.id)).toBe(oldPath);
      expect(queries).toEqual([expect.objectContaining({ table: "profiles", operation: "select", filters: [["eq", "id", user.id]] })]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("is null without a profile row or a picture", async () => {
      useRequestClient([{ id: otherUser.id, avatar_path: null }]);

      expect(await avatars.getPath(user.id)).toBeNull();
      expect(await avatars.getPath(otherUser.id)).toBeNull();
    });

    it("hides a database error behind a generic message", async () => {
      useRequestClient([], { fail: () => true });

      await expect(avatars.getPath(user.id)).rejects.toThrow(new Error("Unable to load your profile picture."));
    });
  });

  describe("read", () => {
    it("downloads the object from the avatars bucket with the request client", async () => {
      const { storageCalls } = useRequestClient([], { objects: { avatars: { [otherPath]: new Uint8Array([7, 8]) } } });

      const bytes = await avatars.read(otherPath);

      expect(new Uint8Array(bytes!)).toEqual(new Uint8Array([7, 8]));
      expect(storageCalls).toEqual([{ bucket: "avatars", operation: "download", paths: [otherPath] }]);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("is null for a missing object", async () => {
      useRequestClient();

      expect(await avatars.read(otherPath)).toBeNull();
    });

    it("is null on a Storage error, such as the read policy hiding the object", async () => {
      useRequestClient([], { objects: { avatars: { [otherPath]: new Uint8Array([7]) } }, failStorage: () => true });

      expect(await avatars.read(otherPath)).toBeNull();
    });
  });

  describe("replace", () => {
    it("uploads under the caller's folder, points their profile at it and deletes the old picture", async () => {
      const { queries, storageCalls, tables, objects } = useAdminClient([
        { id: user.id, avatar_path: oldPath },
        { id: otherUser.id, avatar_path: otherPath },
      ]);

      const path = await avatars.replace(webp);

      expect(path).toMatch(newKey);
      expect(storageCalls).toEqual([
        { bucket: "avatars", operation: "upload", paths: [path], options: { contentType: "image/webp", upsert: false } },
        { bucket: "avatars", operation: "remove", paths: [oldPath] },
      ]);
      expect(queries).toEqual([
        expect.objectContaining({ table: "profiles", operation: "select", filters: [["eq", "id", user.id]] }),
        expect.objectContaining({ table: "profiles", operation: "upsert", values: { id: user.id, avatar_path: path }, onConflict: "id" }),
      ]);
      expect(tables.profiles).toEqual([
        { id: user.id, avatar_path: path },
        { id: otherUser.id, avatar_path: otherPath },
      ]);
      expect(objects.avatars).toEqual({ [path]: webp, [otherPath]: new Uint8Array([2]) });
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("acts only on the signed-in caller", async () => {
      signedIn(otherUser);
      const { queries, storageCalls, tables } = useAdminClient([
        { id: user.id, avatar_path: oldPath },
        { id: otherUser.id, avatar_path: otherPath },
      ]);

      const path = await avatars.replace(webp);

      expect(path.startsWith(`${otherUser.id}/`)).toBe(true);
      expect(storageCalls.flatMap((call) => call.paths).every((key) => key.startsWith(`${otherUser.id}/`))).toBe(true);
      expect(queries.flatMap((query) => query.filters)).toEqual([["eq", "id", otherUser.id]]);
      expect(queries[1].values).toMatchObject({ id: otherUser.id });
      expect(tables.profiles[0]).toEqual({ id: user.id, avatar_path: oldPath });
    });

    it("creates the profile row when the caller has none and deletes nothing", async () => {
      const { storageCalls, tables } = useAdminClient([]);

      const path = await avatars.replace(webp);

      expect(storageCalls.map((call) => call.operation)).toEqual(["upload"]);
      expect(tables.profiles).toEqual([{ id: user.id, avatar_path: path }]);
    });

    it("throws before creating the admin client when nobody is signed in", async () => {
      signedIn(null);

      await expect(avatars.replace(webp)).rejects.toThrow(SAVE_ERROR);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("never writes the profile when the upload fails", async () => {
      const { queries, tables } = useAdminClient([{ id: user.id, avatar_path: oldPath }], {
        failStorage: (call) => call.operation === "upload",
      });

      await expect(avatars.replace(webp)).rejects.toThrow(SAVE_ERROR);
      expect(queries.map((query) => query.operation)).toEqual(["select"]);
      expect(tables.profiles).toEqual([{ id: user.id, avatar_path: oldPath }]);
    });

    it("deletes the new object and keeps the old one when the profile write fails", async () => {
      const { storageCalls, objects } = useAdminClient([{ id: user.id, avatar_path: oldPath }], {
        fail: (query) => query.operation === "upsert",
      });

      await expect(avatars.replace(webp)).rejects.toThrow(SAVE_ERROR);
      const uploaded = storageCalls[0].paths[0];
      expect(storageCalls).toEqual([
        expect.objectContaining({ operation: "upload", paths: [uploaded] }),
        { bucket: "avatars", operation: "remove", paths: [uploaded] },
      ]);
      expect(Object.keys(objects.avatars)).toEqual([oldPath, otherPath]);
    });

    it("still returns the new key when deleting the old object fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { tables } = useAdminClient([{ id: user.id, avatar_path: oldPath }], {
        failStorage: (call) => call.operation === "remove",
      });

      const path = await avatars.replace(webp);

      expect(path).toMatch(newKey);
      expect(tables.profiles).toEqual([{ id: user.id, avatar_path: path }]);
      expect(error).toHaveBeenCalledWith(`Avatars: could not delete ${oldPath}.`);
    });

    it("hides a failed profile read behind the save message and uploads nothing", async () => {
      const { storageCalls } = useAdminClient([], { fail: () => true });

      await expect(avatars.replace(webp)).rejects.toThrow(SAVE_ERROR);
      expect(storageCalls).toEqual([]);
    });
  });

  describe("remove", () => {
    it("clears the caller's picture, then deletes its object", async () => {
      const { queries, storageCalls, tables, objects } = useAdminClient([
        { id: user.id, avatar_path: oldPath },
        { id: otherUser.id, avatar_path: otherPath },
      ]);

      await avatars.remove();

      expect(queries).toEqual([
        expect.objectContaining({ operation: "select", filters: [["eq", "id", user.id]] }),
        expect.objectContaining({ operation: "update", values: { avatar_path: null }, filters: [["eq", "id", user.id]] }),
      ]);
      expect(storageCalls).toEqual([{ bucket: "avatars", operation: "remove", paths: [oldPath] }]);
      expect(tables.profiles).toEqual([
        { id: user.id, avatar_path: null },
        { id: otherUser.id, avatar_path: otherPath },
      ]);
      expect(Object.keys(objects.avatars)).toEqual([otherPath]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("acts only on the signed-in caller", async () => {
      signedIn(otherUser);
      const { queries, storageCalls, tables } = useAdminClient([
        { id: user.id, avatar_path: oldPath },
        { id: otherUser.id, avatar_path: otherPath },
      ]);

      await avatars.remove();

      expect(queries.flatMap((query) => query.filters)).toEqual([["eq", "id", otherUser.id], ["eq", "id", otherUser.id]]);
      expect(storageCalls).toEqual([{ bucket: "avatars", operation: "remove", paths: [otherPath] }]);
      expect(tables.profiles[0]).toEqual({ id: user.id, avatar_path: oldPath });
    });

    it("does nothing when the caller has no picture", async () => {
      const { queries, storageCalls } = useAdminClient([{ id: user.id, avatar_path: null }]);

      await avatars.remove();

      expect(queries.map((query) => query.operation)).toEqual(["select"]);
      expect(storageCalls).toEqual([]);
    });

    it("throws before creating the admin client when nobody is signed in", async () => {
      signedIn(null);

      await expect(avatars.remove()).rejects.toThrow(REMOVE_ERROR);
      expect(mocks.createAdminClient).not.toHaveBeenCalled();
    });

    it("keeps the object when the profile can't be cleared", async () => {
      const { storageCalls } = useAdminClient([{ id: user.id, avatar_path: oldPath }], {
        fail: (query) => query.operation === "update",
      });

      await expect(avatars.remove()).rejects.toThrow(REMOVE_ERROR);
      expect(storageCalls).toEqual([]);
    });
  });
});
