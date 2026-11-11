import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn() }));
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

  it("gives each page render a memo of its own", async () => {
    mocks.createClient.mockResolvedValue({});

    await asPageCaller(() => getAuthenticatedUser());
    await asPageCaller(() => getAuthenticatedUser());

    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});
