import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real auth, server-client and route code, with only the network (supabase-js) and the request
// headers faked: an OAuth app token must get 401 from the REST API, and act as its user inside MCP.
const mocks = vi.hoisted(() => ({ headers: vi.fn(), cookies: vi.fn(), createSupabaseClient: vi.fn() }));
vi.mock("next/headers", () => ({ headers: mocks.headers, cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "http://supabase.test", publishableKey: "pk" }) }));

import { GET as getExpenses } from "@/app/api/expenses/route";
import { getAuth, getAuthenticatedUser } from "@/lib/auth";

const USER = { sub: "user-2", email: "b@example.test" };
const CLAIMS: Record<string, object> = {
  "app-token": { ...USER, client_id: "client-1" },
  "web-token": USER,
};

/** A supabase-js client whose Auth server knows the two tokens above, and whose database must not be reached. */
function fakeSupabaseClient() {
  const claimsFor = async (token: string) =>
    CLAIMS[token] ? { data: { claims: CLAIMS[token] }, error: null } : { data: null, error: { message: "invalid JWT" } };
  return {
    auth: {
      getClaims: vi.fn(claimsFor),
      getUser: vi.fn(async (token: string) =>
        CLAIMS[token] ? { data: { user: { id: USER.sub, email: USER.email } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } },
      ),
    },
    from: () => {
      throw new Error("The database must not be reached");
    },
    rpc: () => {
      throw new Error("The database must not be reached");
    },
  };
}

function withAuthorization(value: string | null) {
  mocks.headers.mockResolvedValue(new Headers(value === null ? {} : { authorization: value }));
}

describe("OAuth app tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseClient.mockImplementation(fakeSupabaseClient);
    withAuthorization(null);
  });

  it("get 401 from a REST route", async () => {
    withAuthorization("Bearer app-token");

    const response = await getExpenses(new NextRequest("http://localhost/api/expenses"), { params: Promise.resolve({}) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("are not a signed-in user for REST, while a web session's JWT is", async () => {
    withAuthorization("Bearer app-token");
    expect(await getAuth().getCurrentUser()).toBeNull();

    withAuthorization("Bearer web-token");
    expect(await getAuth().getCurrentUser()).toEqual({ id: "user-2", email: "b@example.test" });
  });

  it("act as their user inside sessionForAppToken's run", async () => {
    const auth = getAuth();
    expect(await auth.verifyAppToken("app-token")).toEqual({ userId: "user-2", email: "b@example.test", clientId: "client-1" });

    const session = auth.sessionForAppToken("app-token");
    const users = await session.run(async () => [await auth.getCurrentUser(), await getAuthenticatedUser()]);

    expect(users).toEqual([
      { id: "user-2", email: "b@example.test" },
      { id: "user-2", email: "b@example.test" },
    ]);
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("don't carry their user past the run", async () => {
    const session = getAuth().sessionForAppToken("app-token");
    await session.run(() => getAuth().getCurrentUser());

    withAuthorization("Bearer app-token");
    expect(await getAuth().getCurrentUser()).toBeNull();
  });

  it("are refused by verifyAppToken when they are a web session's JWT", async () => {
    expect(await getAuth().verifyAppToken("web-token")).toBeNull();
  });
});
