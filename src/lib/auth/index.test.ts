import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ supabaseAuth: { getCurrentUser: mocks.getCurrentUser } }));

import { getAuthenticatedUser } from "@/lib/auth";
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
