import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);
const mocks = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));

import { logRequest } from "@/lib/http/request-log";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { createAnonClient } from "@/lib/supabase/anon-client";
import { createSessionClient, createThrowawayClient } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { loggedLines } from "@/test/log-lines";

/**
 * The real supabase-js and @supabase/ssr clients, built by the app's own constructors, against a
 * stubbed global `fetch`: shows that PostgREST, RPC, Auth (sign-in, `getClaims`, the admin API) and
 * Storage calls all go through the traced fetch and land in the request line, with nothing from the
 * query string, headers or body.
 */

const SUPABASE_URL = "http://supabase.test";
const USER_ID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";
// Built at run time so no secret-looking literal sits in the repository.
const SECRET_KEY = ["test", "service", "key"].join("-");
const PASSWORD = ["Corr3ct", "Horse", "Battery"].join("-");
const EMAIL = ["someone", "example.test"].join("@");

function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An HS256 JWT with a signature nobody checks here: `getClaims` asks Auth's `/user` about it. */
const ACCESS_TOKEN = [base64url({ alg: "HS256", typ: "JWT" }), base64url({ sub: USER_ID, exp: 4_102_444_800, role: "authenticated" }), "c2ln"].join(".");

const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Supabase as far as these calls need it. */
async function fakeSupabase(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const path = url.pathname;
  if (path === "/rest/v1/expenses") return json([]);
  if (path === "/rest/v1/rpc/authenticate_mcp_token") return json({ message: "denied", code: "42501" }, 403);
  if (path === "/auth/v1/token") {
    return json({ access_token: ACCESS_TOKEN, token_type: "bearer", expires_in: 3600, expires_at: 4_102_444_800, refresh_token: "r", user });
  }
  if (path === "/auth/v1/user") return json(user);
  if (path === `/auth/v1/admin/users/${USER_ID}`) return json(user);
  if (path.startsWith("/storage/v1/object/avatars/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
  return json({ message: "not found" }, 404);
}

const fetchStub = vi.fn(fakeSupabase);

async function requestLine(handle: () => Promise<void>) {
  await logRequest(new Request("http://localhost/api/test"), async () => {
    await handle();
    return new Response(null, { status: 204 });
  });
  const lines = loggedLines(logged, "request");
  expect(lines).toHaveLength(1);
  return lines[0];
}

const names = (line: Record<string, unknown>) => (line.spans as { name: string }[]).map((span) => span.name);

beforeEach(() => {
  logged.length = 0;
  fetchStub.mockClear();
  vi.stubGlobal("fetch", fetchStub);
  vi.stubEnv("SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("SUPABASE_SECRET_KEY", SECRET_KEY);
  mocks.headers.mockResolvedValue(new Headers());
  mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the Supabase clients' calls in the request line", () => {
  it("times the cookie client's table reads and RPCs, with their status, never the filter values", async () => {
    const line = await requestLine(async () => {
      const supabase = await createClient();
      await supabase.from("expenses").select("id").eq("user_id", USER_ID).eq("notes", EMAIL);
      await supabase.rpc("authenticate_mcp_token", { p_token_hash: "abc" } as never);
    });

    expect(line.spans).toEqual([
      { name: "db.expenses.get", ms: expect.any(Number) },
      { name: "rpc.authenticate_mcp_token", ms: expect.any(Number), status: 403 },
    ]);
    expect(line).toMatchObject({ dbCalls: 2, dbMs: expect.any(Number) });
  });

  it("times the bearer token client", async () => {
    mocks.headers.mockResolvedValue(new Headers({ authorization: `Bearer ${ACCESS_TOKEN}` }));
    const line = await requestLine(async () => {
      await (await createClient()).from("expenses").select("id");
    });
    expect(names(line)).toEqual(["db.expenses.get"]);
  });

  it("times Auth: sign-in, getClaims and the admin API", async () => {
    const line = await requestLine(async () => {
      const signIn = await createThrowawayClient().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      expect(signIn.error).toBeNull();
      const claims = await createSessionClient().auth.getClaims(ACCESS_TOKEN);
      expect(claims.error).toBeNull();
      const admin = await createAdminClient().auth.admin.getUserById(USER_ID);
      expect(admin.error).toBeNull();
    });

    expect(names(line)).toEqual(["auth.token", "auth.user", "auth.admin.users.:id"]);
    expect(line.dbCalls).toBe(3);
  });

  it("times Storage, by bucket only", async () => {
    const line = await requestLine(async () => {
      const download = await createAnonClient().storage.from("avatars").download(`${USER_ID}/private-name.webp`);
      expect(download.error).toBeNull();
    });
    expect(names(line)).toEqual(["storage.avatars"]);
  });

  it("never writes a query string, a header, a body, the email, the password, the token or the key", async () => {
    await requestLine(async () => {
      const supabase = await createClient();
      await supabase.from("expenses").select("id").eq("notes", EMAIL);
      await createThrowawayClient().auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      await createAdminClient().auth.admin.getUserById(USER_ID);
      await createAnonClient().storage.from("avatars").download(`${USER_ID}/private-name.webp`);
    });

    expect(fetchStub).toHaveBeenCalledTimes(4);
    const written = logged.join("");
    for (const leaked of [EMAIL, "someone", PASSWORD, ACCESS_TOKEN, SECRET_KEY, "test-publishable", "private-name", "grant_type", "?", "Bearer", "apikey"]) {
      expect(written).not.toContain(leaked);
    }
  });
});
