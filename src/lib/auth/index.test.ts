import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn() }));
// React's server `cache` keeps one answer per function for the render in progress; outside a server
// render (as in tests) it keeps nothing. This stands in for it: `render.answers` is one render.
const render = vi.hoisted(() => ({ answers: new Map<unknown, unknown>() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (fn: () => unknown) => () => {
    if (!render.answers.has(fn)) render.answers.set(fn, fn());
    return render.answers.get(fn);
  },
}));
vi.mock("@/lib/supabase/auth", () => ({ supabaseAuth: { getCurrentUser: mocks.getCurrentUser } }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: mocks.createClient,
}));

import { asPageCaller, getAuthenticatedUser } from "@/lib/auth";
import { runWithRequestMemo } from "@/lib/request-memo";

const user = { id: "10000000-0000-4000-8000-000000000001", email: "alex@example.com" };

beforeEach(() => {
  vi.resetAllMocks();
  render.answers = new Map();
  mocks.getCurrentUser.mockResolvedValue(user);
});

describe("getAuthenticatedUser", () => {
  it("asks the auth provider once per request, however many checks ask (PF4)", async () => {
    const answers = await runWithRequestMemo(async () => [await getAuthenticatedUser(), await getAuthenticatedUser()]);

    expect(answers).toEqual([user, user]);
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("asks again in another request", async () => {
    await runWithRequestMemo(() => getAuthenticatedUser());
    await runWithRequestMemo(() => getAuthenticatedUser());

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});

describe("asPageCaller", () => {
  it("runs a server component's reads as the request's cookie session, asking the provider once (PF5)", async () => {
    mocks.createClient.mockResolvedValue({ marker: "the request's cookie client" });

    const answers = await asPageCaller(async () => [await getAuthenticatedUser(), await getAuthenticatedUser()]);

    expect(answers).toEqual([user, user]);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("shares one client and one memo between the layout and the page of one render (PF6)", async () => {
    mocks.createClient.mockResolvedValue({});

    const [layout, page] = await Promise.all([asPageCaller(() => getAuthenticatedUser()), asPageCaller(() => getAuthenticatedUser())]);

    expect([layout, page]).toEqual([user, user]);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("gives each page render a memo of its own", async () => {
    mocks.createClient.mockResolvedValue({});

    await asPageCaller(() => getAuthenticatedUser());
    render.answers = new Map();
    await asPageCaller(() => getAuthenticatedUser());

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});
