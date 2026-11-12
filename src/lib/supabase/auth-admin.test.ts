import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";
import { loggedLines } from "@/test/log-lines";

const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

const mocks = vi.hoisted(() => {
  // config.ts reads the URL when it is first imported; the secret key is read on each use.
  process.env.SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
  return { createSupabaseClient: vi.fn() };
});
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));

import { getAuthAdmin } from "@/lib/auth";
import { tracedFetch } from "@/lib/log/traced-fetch";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createSupabaseAuthAdmin } from "@/lib/supabase/auth-admin";

const SECRET_KEY = "sb_secret_test_key";
const kid = { id: "10000000-0000-4000-8000-000000002801", email: "mia@kids.ifam.invalid" };
const familyId = "10000000-0000-4000-8000-000000002899";

const input = {
  email: kid.email,
  password: "a long password",
  username: "mia",
  displayName: "Mia",
  managedByFamily: familyId,
  mustChangePassword: true,
};

type AdminResponses = Partial<Record<"createUser" | "deleteUser" | "updateUserById" | "getUserById" | "generateLink", unknown>>;

const ok = (user: { id: string; email?: string } | null = kid) => ({ data: { user }, error: null });
const fails = (code: string | undefined, message = "provider says no") => ({ data: { user: null }, error: { code, message } });
const linked = (user: { id: string; email?: string } = kid) => ({
  data: { properties: { hashed_token: "hashed-token-1", action_link: "http://supabase.test/verify" }, user },
  error: null,
});

/** Builds the admin client the implementation gets: the fake query builder plus mocked `auth.admin` calls. */
function useAdminClient(
  profiles: Record<string, unknown>[] = [],
  responses: AdminResponses = {},
  options?: FakeSupabaseOptions,
) {
  const database = fakeSupabase({ profiles }, options);
  const admin = {
    createUser: vi.fn().mockResolvedValue(responses.createUser ?? ok()),
    deleteUser: vi.fn().mockResolvedValue(responses.deleteUser ?? ok()),
    updateUserById: vi.fn().mockResolvedValue(responses.updateUserById ?? ok()),
    getUserById: vi.fn().mockResolvedValue(responses.getUserById ?? ok()),
    generateLink: vi.fn().mockResolvedValue(responses.generateLink ?? linked()),
  };
  mocks.createSupabaseClient.mockReturnValue({ ...database.client, auth: { admin } });
  return { ...database, admin };
}

describe("Supabase AuthAdmin", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("SUPABASE_SECRET_KEY", SECRET_KEY);
  });

  afterEach(() => vi.unstubAllEnvs());

  describe("the admin client", () => {
    it("uses the secret key and never keeps, refreshes or detects a session", () => {
      useAdminClient();

      createSupabaseAuthAdmin();

      expect(mocks.createSupabaseClient).toHaveBeenCalledExactlyOnceWith("http://supabase.test", SECRET_KEY, {
        global: { fetch: tracedFetch },
        db: { retry: false },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
    });

    it("gets its own traced fetch when given another time limit (the worker's)", () => {
      mocks.createSupabaseClient.mockReturnValue({});

      createAdminClient({ timeoutMs: 20_000 });

      const { global } = mocks.createSupabaseClient.mock.calls[0][2];
      expect(typeof global.fetch).toBe("function");
      expect(global.fetch).not.toBe(tracedFetch);
    });

    it.each([
      ["missing", undefined],
      ["empty", ""],
    ])("throws a clear error when the secret key is %s", (_, value) => {
      vi.stubEnv("SUPABASE_SECRET_KEY", value);

      expect(() => createSupabaseAuthAdmin()).toThrow(/SUPABASE_SECRET_KEY/);
      expect(() => getAuthAdmin()).toThrow(/SUPABASE_SECRET_KEY/);
      expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
    });

    it("is what getAuthAdmin returns when the key is set", async () => {
      const { admin } = useAdminClient();

      await getAuthAdmin().setPassword(kid.id, "a new password");

      expect(admin.updateUserById).toHaveBeenCalledOnce();
    });
  });

  describe("createUser", () => {
    it("creates a confirmed account and writes its profile", async () => {
      const { admin, queries, tables } = useAdminClient();

      expect(await createSupabaseAuthAdmin().createUser(input)).toEqual(kid);

      expect(admin.createUser).toHaveBeenCalledExactlyOnceWith({
        email: input.email,
        password: input.password,
        email_confirm: true,
      });
      expect(queries).toEqual([expect.objectContaining({ table: "profiles", operation: "upsert", onConflict: "id" })]);
      expect(tables.profiles).toEqual([
        {
          id: kid.id,
          email: kid.email,
          username: "mia",
          display_name: "Mia",
          managed_by_family: familyId,
          must_change_password: true,
        },
      ]);
      expect(admin.deleteUser).not.toHaveBeenCalled();
    });

    it("fills in the profile row the signup trigger already made", async () => {
      const { tables } = useAdminClient([{ id: kid.id, email: kid.email, currency: "EUR" }]);

      await createSupabaseAuthAdmin().createUser({ ...input, managedByFamily: null, mustChangePassword: false });

      expect(tables.profiles).toEqual([
        expect.objectContaining({
          id: kid.id,
          currency: "EUR",
          username: "mia",
          managed_by_family: null,
          must_change_password: false,
        }),
      ]);
    });

    it.each([
      ["email_exists", new DomainError("An account with that email already exists.", 409)],
      ["user_already_exists", new DomainError("An account with that email already exists.", 409)],
      ["weak_password", new DomainError("Password is too weak.", 422)],
      [undefined, new Error("Unable to create the account.")],
    ])("translates a %s error from the provider and writes no profile", async (code, expected) => {
      const { admin, queries } = useAdminClient([], { createUser: fails(code, "Password is too weak.") });

      const error = await createSupabaseAuthAdmin().createUser(input).catch((caught: unknown) => caught);

      expect(error).toEqual(expected);
      expect(error).toBeInstanceOf(expected.constructor);
      expect(queries).toEqual([]);
      expect(admin.deleteUser).not.toHaveBeenCalled();
    });

    it.each([
      ["a taken username", { code: "23505", message: "duplicate key" }, new DomainError("That username is taken.", 409)],
      ["an invalid username", { code: "23514", message: "check" }, new DomainError("That username or display name isn't valid.", 422)],
      ["any other database error", true, new Error("Unable to create the account.")],
    ] as const)("deletes the new account again when the profile write fails on %s", async (_, failure, expected) => {
      const { admin } = useAdminClient([], {}, { fail: () => failure });

      const error = await createSupabaseAuthAdmin().createUser(input).catch((caught: unknown) => caught);

      expect(error).toEqual(expected);
      expect(error).toBeInstanceOf(expected.constructor);
      expect(admin.deleteUser).toHaveBeenCalledExactlyOnceWith(kid.id);
    });

    it("still throws the profile error when the clean-up fails too", async () => {
      logged.length = 0;
      const { admin } = useAdminClient([], { deleteUser: fails(undefined) }, { fail: () => ({ code: "23505", message: "duplicate" }) });

      await expect(createSupabaseAuthAdmin().createUser(input)).rejects.toThrow("That username is taken.");

      expect(admin.deleteUser).toHaveBeenCalledExactlyOnceWith(kid.id);
      expect(loggedLines(logged, "auth_user_cleanup_failed")).toEqual([expect.objectContaining({ level: "error", userId: kid.id })]);
      expect(logged.join("")).not.toContain(input.password);
      expect(logged.join("")).not.toContain(SECRET_KEY);
      expect(logged.join("")).not.toContain(kid.email);
    });
  });

  describe("deleteUser", () => {
    it("deletes the account", async () => {
      const { admin } = useAdminClient();

      await createSupabaseAuthAdmin().deleteUser(kid.id);

      expect(admin.deleteUser).toHaveBeenCalledExactlyOnceWith(kid.id);
    });

    it("deletes every file in the account's avatar folder first, and nobody else's", async () => {
      const other = "20000000-0000-4000-8000-000000000001";
      const objects = {
        avatars: {
          [`${kid.id}/11111111-1111-4111-8111-111111111111.webp`]: new Uint8Array([1]),
          [`${kid.id}/22222222-2222-4222-8222-222222222222.webp`]: new Uint8Array([2]),
          [`${other}/33333333-3333-4333-8333-333333333333.webp`]: new Uint8Array([3]),
        },
      };
      const { admin, storageCalls } = useAdminClient([], {}, { objects });
      admin.deleteUser.mockImplementation(async () => {
        // The files are gone before the auth user is.
        expect(Object.keys(objects.avatars)).toEqual([`${other}/33333333-3333-4333-8333-333333333333.webp`]);
        return ok();
      });

      await createSupabaseAuthAdmin().deleteUser(kid.id);

      expect(admin.deleteUser).toHaveBeenCalledExactlyOnceWith(kid.id);
      expect(storageCalls.map((call) => `${call.operation}:${call.paths.length}`)).toEqual(["list:1", "remove:2"]);
    });

    it.each([
      ["listing", 0],
      ["removing", 1],
    ])("doesn't delete the auth user when %s the avatar files fails", async (_, failingCall) => {
      const objects = { avatars: { [`${kid.id}/11111111-1111-4111-8111-111111111111.webp`]: new Uint8Array([1]) } };
      const { admin } = useAdminClient([], {}, { objects, failStorage: (_call, index) => index === failingCall });

      await expect(createSupabaseAuthAdmin().deleteUser(kid.id)).rejects.toThrow(new Error("Unable to delete the account."));

      expect(admin.deleteUser).not.toHaveBeenCalled();
    });

    it("reports an unknown account as not found", async () => {
      useAdminClient([], { deleteUser: fails("user_not_found") });

      await expect(createSupabaseAuthAdmin().deleteUser(kid.id)).rejects.toEqual(
        new DomainError("That account doesn't exist.", 404),
      );
    });

    it("hides any other provider error behind a generic message", async () => {
      useAdminClient([], { deleteUser: fails("unexpected_failure", "private details") });

      await expect(createSupabaseAuthAdmin().deleteUser(kid.id)).rejects.toThrow(new Error("Unable to delete the account."));
    });
  });

  describe("setPassword", () => {
    it("sets the account's password", async () => {
      const { admin } = useAdminClient();

      await createSupabaseAuthAdmin().setPassword(kid.id, "a new password");

      expect(admin.updateUserById).toHaveBeenCalledExactlyOnceWith(kid.id, { password: "a new password" });
    });

    it("passes on the provider's message for a weak password", async () => {
      useAdminClient([], { updateUserById: fails("weak_password", "Password should be at least 8 characters.") });

      await expect(createSupabaseAuthAdmin().setPassword(kid.id, "short")).rejects.toEqual(
        new DomainError("Password should be at least 8 characters.", 422),
      );
    });

    it("hides any other provider error behind a generic message", async () => {
      useAdminClient([], { updateUserById: fails(undefined, "private details") });

      await expect(createSupabaseAuthAdmin().setPassword(kid.id, "a new password")).rejects.toThrow(
        new Error("Unable to change the password."),
      );
    });
  });

  describe("findEmailByUsername", () => {
    it("returns the auth user's email for a username", async () => {
      const { admin, queries } = useAdminClient([
        { id: "other", username: "leo" },
        { id: kid.id, username: "mia", email: "stale@example.test" },
      ]);

      expect(await createSupabaseAuthAdmin().findEmailByUsername("mia")).toBe(kid.email);

      expect(queries[0]).toMatchObject({ table: "profiles", operation: "select", filters: [["eq", "username", "mia"]] });
      expect(admin.getUserById).toHaveBeenCalledExactlyOnceWith(kid.id);
    });

    it("matches the username in lowercase", async () => {
      const { queries } = useAdminClient([{ id: kid.id, username: "mia" }]);

      expect(await createSupabaseAuthAdmin().findEmailByUsername(" Mia ")).toBe(kid.email);
      expect(queries[0].filters).toEqual([["eq", "username", "mia"]]);
    });

    it("returns null for an unknown username without asking the auth provider", async () => {
      const { admin } = useAdminClient([{ id: kid.id, username: "mia" }]);

      expect(await createSupabaseAuthAdmin().findEmailByUsername("leo")).toBeNull();
      expect(admin.getUserById).not.toHaveBeenCalled();
    });

    it("returns null when the profile's account no longer exists", async () => {
      useAdminClient([{ id: kid.id, username: "mia" }], { getUserById: fails("user_not_found") });

      expect(await createSupabaseAuthAdmin().findEmailByUsername("mia")).toBeNull();
    });

    it("returns null when the account has no email", async () => {
      useAdminClient([{ id: kid.id, username: "mia" }], { getUserById: ok({ id: kid.id }) });

      expect(await createSupabaseAuthAdmin().findEmailByUsername("mia")).toBeNull();
    });

    it("hides a database error behind a generic message", async () => {
      useAdminClient([], {}, { fail: () => true });

      await expect(createSupabaseAuthAdmin().findEmailByUsername("mia")).rejects.toThrow(
        new Error("Unable to look up the username."),
      );
    });

    it("hides a provider error behind a generic message", async () => {
      useAdminClient([{ id: kid.id, username: "mia" }], { getUserById: fails("unexpected_failure") });

      await expect(createSupabaseAuthAdmin().findEmailByUsername("mia")).rejects.toThrow(
        new Error("Unable to look up the username."),
      );
    });
  });

  describe("startSessionForUser", () => {
    const adult = { id: "10000000-0000-4000-8000-000000002802", email: "sam@example.test" };
    const PUBLISHABLE_KEY = "sb_publishable_test_key";

    type VerifyResponse = { data: { user: unknown; session: unknown }; error: unknown };
    const verified = (user: { id: string; email?: string } = adult): VerifyResponse => ({
      data: { user, session: { access_token: "access-token" } },
      error: null,
    });

    /** The admin client for the secret key, and a separate session client for the publishable key. */
    function useClients({
      generateLink = linked(adult) as unknown,
      verifyOtp = verified() as VerifyResponse | Error,
    } = {}) {
      const admin = {
        generateLink: vi.fn().mockResolvedValue(generateLink),
        createUser: vi.fn(),
        deleteUser: vi.fn(),
        updateUserById: vi.fn(),
        getUserById: vi.fn(),
      };
      const sessionAuth = {
        verifyOtp: verifyOtp instanceof Error ? vi.fn().mockRejectedValue(verifyOtp) : vi.fn().mockResolvedValue(verifyOtp),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "access-token" } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        signInWithOtp: vi.fn(),
      };
      const adminClient = { auth: { admin, signInWithOtp: vi.fn() } };
      const sessionClient = { auth: sessionAuth };
      mocks.createSupabaseClient.mockImplementation((_url: string, key: string) =>
        key === SECRET_KEY ? adminClient : sessionClient,
      );
      return { admin, adminClient, sessionAuth };
    }

    it("redeems an admin magic link on a fresh session client and returns the user's session", async () => {
      const { admin, sessionAuth } = useClients();

      const session = await createSupabaseAuthAdmin().startSessionForUser(adult);

      expect(session).toMatchObject({ userId: adult.id, email: adult.email });
      expect(admin.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: adult.email });
      expect(sessionAuth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: "hashed-token-1", type: "email" });
      expect(mocks.createSupabaseClient).toHaveBeenCalledWith("http://supabase.test", PUBLISHABLE_KEY, {
        global: { fetch: tracedFetch },
        db: { retry: false },
        auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
      });
      expect(await session?.isActive()).toBe(true);
    });

    it("runs callbacks as the user, on the session client", async () => {
      useClients();
      const session = await createSupabaseAuthAdmin().startSessionForUser(adult);

      expect(session?.run(() => "result")).toBe("result");
    });

    it("never calls anything that sends an email", async () => {
      const { adminClient, sessionAuth } = useClients();

      await createSupabaseAuthAdmin().startSessionForUser(adult);

      expect(sessionAuth.signInWithOtp).not.toHaveBeenCalled();
      expect(adminClient.auth.signInWithOtp).not.toHaveBeenCalled();
      expect(adminClient.auth.admin.createUser).not.toHaveBeenCalled();
    });

    it("signs out only its own session on end()", async () => {
      const { sessionAuth } = useClients();
      const session = await createSupabaseAuthAdmin().startSessionForUser(adult);

      await session?.end();

      expect(sessionAuth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    });

    it.each([
      ["an error", fails("user_not_found")],
      ["no token", { data: { properties: {}, user: adult }, error: null }],
    ])("returns null without redeeming anything when generateLink answers with %s", async (_, generateLink) => {
      const { sessionAuth } = useClients({ generateLink });

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
      expect(sessionAuth.verifyOtp).not.toHaveBeenCalled();
    });

    it("returns null when generateLink throws", async () => {
      const { admin } = useClients();
      admin.generateLink.mockRejectedValue(new Error("network down"));

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
    });

    it("refuses when the email now belongs to another account", async () => {
      const { sessionAuth } = useClients({ generateLink: linked({ id: "someone-else", email: adult.email }) });

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
      expect(sessionAuth.verifyOtp).not.toHaveBeenCalled();
    });

    it.each([
      ["an error", { data: { user: null, session: null }, error: { message: "Token has expired or is invalid" } }],
      ["no session", { data: { user: adult, session: null }, error: null }],
    ])("returns null when verifyOtp answers with %s", async (_, verifyOtp) => {
      useClients({ verifyOtp });

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
    });

    it("returns null when verifyOtp throws", async () => {
      useClients({ verifyOtp: new Error("network down") });

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
    });

    it("signs out and refuses a session that came back for another user", async () => {
      const { sessionAuth } = useClients({ verifyOtp: verified({ id: "someone-else", email: adult.email }) });

      expect(await createSupabaseAuthAdmin().startSessionForUser(adult)).toBeNull();
      expect(sessionAuth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
    });
  });
  describe("signOutEverywhere", () => {
    const PUBLISHABLE_KEY = "sb_publishable_test_key";

    /** The admin client for the secret key, and a throwaway client for the publishable key. */
    function useClients({
      getUserById = ok() as unknown,
      generateLink = linked() as unknown,
      verifyOtp = { data: { user: kid, session: { access_token: "kid-access-token" } }, error: null } as unknown,
      signOut = { data: null, error: null } as unknown,
    } = {}) {
      const admin = {
        getUserById: vi.fn().mockResolvedValue(getUserById),
        generateLink: vi.fn().mockResolvedValue(generateLink),
        signOut: vi.fn().mockResolvedValue(signOut),
        createUser: vi.fn(),
        deleteUser: vi.fn(),
        updateUserById: vi.fn(),
      };
      const throwawayAuth = { verifyOtp: vi.fn().mockResolvedValue(verifyOtp), signOut: vi.fn(), signInWithOtp: vi.fn() };
      mocks.createSupabaseClient.mockImplementation((_url: string, key: string) =>
        key === SECRET_KEY ? { auth: { admin } } : { auth: throwawayAuth },
      );
      return { admin, throwawayAuth };
    }

    it("opens a session with a one-time token and ends every session of the account through the admin API", async () => {
      const { admin, throwawayAuth } = useClients();

      await createSupabaseAuthAdmin().signOutEverywhere(kid.id);

      expect(admin.getUserById).toHaveBeenCalledExactlyOnceWith(kid.id);
      expect(admin.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: kid.email });
      expect(throwawayAuth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ token_hash: "hashed-token-1", type: "email" });
      expect(admin.signOut).toHaveBeenCalledExactlyOnceWith("kid-access-token", "global");
      // The token is redeemed on a client that keeps no session and never refreshes one.
      expect(mocks.createSupabaseClient).toHaveBeenCalledWith("http://supabase.test", PUBLISHABLE_KEY, {
        global: { fetch: tracedFetch },
        db: { retry: false },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      expect(throwawayAuth.signInWithOtp).not.toHaveBeenCalled();
    });

    it("reports an unknown account as not found", async () => {
      useClients({ getUserById: fails("user_not_found") });

      await expect(createSupabaseAuthAdmin().signOutEverywhere(kid.id)).rejects.toEqual(
        new DomainError("That account doesn't exist.", 404),
      );
    });

    it.each([
      ["the account has no email", { getUserById: ok({ id: kid.id }) }],
      ["no link can be made", { generateLink: { data: { properties: null, user: null }, error: { message: "no" } } }],
      ["the link is for another account", { generateLink: linked({ id: "10000000-0000-4000-8000-000000002899", email: kid.email }) }],
      ["the token can't be redeemed", { verifyOtp: { data: { user: null, session: null }, error: { message: "expired" } } }],
      ["the session is another account's", { verifyOtp: { data: { user: { id: "someone-else" }, session: { access_token: "x" } }, error: null } }],
    ])("throws a generic error, signing nobody out, when %s", async (_, responses) => {
      const { admin } = useClients(responses);

      await expect(createSupabaseAuthAdmin().signOutEverywhere(kid.id)).rejects.toThrow("Unable to sign the account out.");
      expect(admin.signOut).not.toHaveBeenCalled();
    });

    it("throws a generic error when the admin sign-out fails", async () => {
      useClients({ signOut: { data: null, error: { message: "private provider failure" } } });

      await expect(createSupabaseAuthAdmin().signOutEverywhere(kid.id)).rejects.toThrow("Unable to sign the account out.");
    });
  });
});
