import type { ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import type { AccountData } from "@/lib/account/types";
import {
  afterCurrencyChanged,
  afterFamilyChanged,
  afterFamilyDeleted,
  afterFamilyJoined,
  afterMemberRemoved,
  afterSignOut,
  invalidateAfterAvatarChange,
} from "@/lib/api/invalidate";

const CACHED_KEYS = [
  "/api/account",
  "/api/investments",
  "/api/net-worth",
  "/api/expense-tabs",
  "/api/expense-tabs/tab-1/expenses?revision=r1",
  "/api/expense-tabs/tab-2/expenses?revision=r2",
  "/api/dashboard?period=1m&granularity=day&date=2026-10-14",
  "/api/imports",
  "/api/expenses?month=2026-10",
  "/api/expenses?month=2026-09&context=main",
  "/api/investment-transactions?accountId=a&instrument=X&currency=EUR",
];

type Call = { keys: string[]; data: unknown; options: unknown };

/** Records each mutate call with the cached keys it targets. */
function recorder() {
  const calls: Call[] = [];
  const mutate = vi.fn((key: unknown, data?: unknown, options?: unknown) => {
    const keys = typeof key === "function"
      ? CACHED_KEYS.filter((cached) => (key as (value: string) => boolean)(cached))
      : [key as string];
    calls.push({ keys, data, options });
    return Promise.resolve(undefined);
  });
  return { mutate: mutate as unknown as ScopedMutator, calls };
}

const NO_REVALIDATE = { revalidate: false };

describe("cache invalidation after mutations", () => {
  it("sign-out clears everything without refetching", async () => {
    const signOut = recorder();
    await afterSignOut(signOut.mutate);
    expect(signOut.calls).toEqual([{ keys: CACHED_KEYS, data: undefined, options: NO_REVALIDATE }]);
  });

  it("caches the joined family and reloads the account", async () => {
    const response = { family: { family: { id: "f1", name: "Home", createdAt: "2026-10-16T00:00:00Z" }, members: [] } };
    const joined = recorder();
    await afterFamilyJoined(joined.mutate, response);
    expect(joined.calls).toEqual([
      { keys: ["/api/family"], data: response, options: NO_REVALIDATE },
      { keys: ["/api/account"], data: undefined, options: undefined },
    ]);
  });

  it("reloads the family after a member is removed", async () => {
    const removed = recorder();
    await afterMemberRemoved(removed.mutate);
    expect(removed.calls).toEqual([{ keys: ["/api/family"], data: undefined, options: undefined }]);
  });

  it("caches no family and reloads the account after the family is deleted", async () => {
    const deleted = recorder();
    await afterFamilyDeleted(deleted.mutate);
    expect(deleted.calls).toEqual([
      { keys: ["/api/family"], data: { family: null }, options: NO_REVALIDATE },
      { keys: ["/api/account"], data: undefined, options: undefined },
    ]);
  });

  // The account and the family list are stable data (stable-data.ts): no page asks for them again, so
  // each write that changes one has to update its key here.
  describe("stable data", () => {
    const FAMILY = { family: null };
    const ACCOUNT = { currency: "USD" } as AccountData;

    it("caches the family the server answered with after a change to it", async () => {
      const changed = recorder();
      await afterFamilyChanged(changed.mutate, FAMILY);
      expect(changed.calls).toEqual([{ keys: ["/api/family"], data: FAMILY, options: NO_REVALIDATE }]);
    });

    it("reloads the account and the family list after the picture changes (the list shows pictures)", async () => {
      const avatar = recorder();
      await invalidateAfterAvatarChange(avatar.mutate);
      expect(avatar.calls.map((call) => call.keys).flat().sort()).toEqual(["/api/account", "/api/family"]);
    });

    it("caches the new account and reloads the family list after the currency changes (the list shows each member's currency)", async () => {
      const currency = recorder();
      await afterCurrencyChanged(currency.mutate, ACCOUNT);
      expect(currency.calls).toEqual([
        { keys: ["/api/account"], data: ACCOUNT, options: NO_REVALIDATE },
        { keys: ["/api/family"], data: undefined, options: undefined },
      ]);
    });
  });
});
