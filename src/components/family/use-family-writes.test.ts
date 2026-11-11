import type { ScopedMutator } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { restFamilyApi, type FamilyApi } from "@/components/family/family-api";
import { familyWrites } from "@/components/family/use-family-writes";
import { ACCOUNT_API_KEY, FAMILY_API_KEY, FAMILY_INVITES_API_KEY, type FamilyResponse } from "@/lib/api/keys";

const FAMILY: FamilyResponse = { family: null };

function recorder() {
  const keys: unknown[] = [];
  const mutate = vi.fn(async (key: unknown) => void keys.push(key));
  return { mutate: mutate as unknown as ScopedMutator, keys };
}

function api(overrides: Partial<FamilyApi> = {}): FamilyApi {
  return {
    createFamily: vi.fn(async () => FAMILY),
    deleteFamily: vi.fn(async () => undefined),
    previewInvite: vi.fn(),
    joinFamily: vi.fn(async () => FAMILY),
    createKid: vi.fn(async () => FAMILY),
    createInvite: vi.fn(),
    revokeInvite: vi.fn(async () => undefined),
    removeMember: vi.fn(async () => undefined),
    resetKidPassword: vi.fn(async () => undefined),
    deleteKidAccount: vi.fn(async () => FAMILY),
    setPermissions: vi.fn(async () => FAMILY),
    setColor: vi.fn(async () => FAMILY),
    dismissNotice: vi.fn(async () => undefined),
    ...overrides,
  };
}

/**
 * The family list and the account are stable data (`stable-data.ts`): nothing asks for them again when
 * a page opens, so every write that changes one must update its key.
 */
describe("familyWrites and stable data", () => {
  const writes: [string, (w: ReturnType<typeof familyWrites>) => Promise<unknown>, string[]][] = [
    ["creating a family", (w) => w.createFamily("Smiths"), [FAMILY_API_KEY, ACCOUNT_API_KEY]],
    ["joining a family", (w) => w.joinFamily("CODE"), [FAMILY_API_KEY, ACCOUNT_API_KEY]],
    ["deleting the family", (w) => w.deleteFamily("Smiths"), [FAMILY_API_KEY, ACCOUNT_API_KEY]],
    ["adding a kid", (w) => w.createKid({} as never), [FAMILY_API_KEY]],
    ["removing a member", (w) => w.removeMember("m-1"), [FAMILY_API_KEY]],
    ["deleting a kid's account", (w) => w.deleteKidAccount("m-1", { currentPassword: "pw", confirmName: "Ana" }), [FAMILY_API_KEY]],
    ["changing permissions", (w) => w.setPermissions("m-1", {} as never), [FAMILY_API_KEY]],
    ["choosing a colour", (w) => w.setColor("m-1", 3), [FAMILY_API_KEY]],
  ];

  it.each(writes)("updates the keys it changes after %s", async (_name, write, expected) => {
    const swr = recorder();
    await write(familyWrites(api(), swr.mutate));
    expect([...new Set(swr.keys)].sort()).toEqual([...expected].sort());
  });
});

describe("familyWrites", () => {
  it("caches the family the server answered with after a permissions change", async () => {
    const swr = recorder();
    await familyWrites(api(), swr.mutate).setPermissions("m-1", {} as never);
    expect(swr.keys).toContain(FAMILY_API_KEY);
  });

  it("refreshes the invites after creating or revoking one", async () => {
    const swr = recorder();
    const writes = familyWrites(api({ createInvite: vi.fn(async () => ({ code: "ABC" }) as never) }), swr.mutate);
    await writes.createInvite({ role: "parent" });
    await writes.revokeInvite("i-1");
    expect(swr.keys.filter((key) => key === FAMILY_INVITES_API_KEY)).toHaveLength(2);
  });

  it("refreshes nothing when the server refuses, and rethrows its error for the form", async () => {
    const swr = recorder();
    const writes = familyWrites(api({ deleteFamily: vi.fn(async () => { throw new Error("The name does not match."); }) }), swr.mutate);
    await expect(writes.deleteFamily("Pop")).rejects.toThrow("The name does not match.");
    expect(swr.keys).toEqual([]);
  });

  it("passes the typed confirmation to the account delete", async () => {
    const swr = recorder();
    const fake = api();
    await familyWrites(fake, swr.mutate).deleteKidAccount("m-1", { currentPassword: "pw", confirmName: "Ana" });
    expect(fake.deleteKidAccount).toHaveBeenCalledWith("m-1", { currentPassword: "pw", confirmName: "Ana" });
  });
});

describe("restFamilyApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes a family with the typed name in the body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await restFamilyApi.deleteFamily("Pop");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(FAMILY_API_KEY);
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ confirmName: "Pop" });
  });

  it("sends permissions only for a kid's invite", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await restFamilyApi.createInvite({ role: "parent", permissions: { canView: true } as never });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ role: "parent" });
  });
});
