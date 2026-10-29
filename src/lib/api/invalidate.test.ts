import { mutate as globalMutate, type ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import {
  afterExpenseCreated,
  afterExpenseDeleted,
  afterImportChange,
  afterImportDraftChange,
  afterFamilyDeleted,
  afterFamilyJoined,
  afterMemberRemoved,
  afterInvestmentChange,
  afterNetWorthChange,
  afterPasswordChange,
  afterSignIn,
  afterSignOut,
  afterTabDeleted,
  afterTabSaved,
} from "@/lib/api/invalidate";
import type { AccountData } from "@/lib/account/types";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { ExpensesData } from "@/lib/expenses/types";
import { aTab, anExpense } from "@/test/builders";

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

const expense = anExpense({ id: "e-2", amount: 30 });
const tab = aTab({ id: "tab-1", name: "Car" });
const NO_REVALIDATE = { revalidate: false };

describe("cache invalidation after mutations", () => {
  it("afterExpenseCreated updates both month ledgers, then refreshes tab ledgers and dashboards", async () => {
    const { mutate, calls } = recorder();
    await afterExpenseCreated(mutate, "2026-10", expense);

    expect(calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expenses?month=2026-10"], NO_REVALIDATE],
      [["/api/expenses?month=2026-10&context=main"], NO_REVALIDATE],
      [["/api/expense-tabs/tab-1/expenses?revision=r1", "/api/expense-tabs/tab-2/expenses?revision=r2"], undefined],
      [["/api/dashboard?period=1m&granularity=day&date=2026-10-14"], undefined],
    ]);
    const update = calls[0].data as (current?: ExpensesData) => ExpensesData | undefined;
    expect(update(undefined)).toBeUndefined();
    expect(update({ expenses: [{ id: "e-1", amount: 10 }], total: 10, average: 10 } as ExpensesData))
      .toMatchObject({ expenses: [{ id: "e-2" }, { id: "e-1" }], total: 40, average: 20 });
  });

  it("afterImportChange refetches every month ledger, tab ledgers, dashboards and the list of imports", () => {
    const { mutate, calls } = recorder();
    afterImportChange(mutate);

    expect(calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expenses?month=2026-10", "/api/expenses?month=2026-09&context=main"], undefined],
      [["/api/expense-tabs/tab-1/expenses?revision=r1", "/api/expense-tabs/tab-2/expenses?revision=r2"], undefined],
      [["/api/dashboard?period=1m&granularity=day&date=2026-10-14"], undefined],
      [["/api/imports"], undefined],
    ]);
  });

  it("afterImportDraftChange refetches only the list of imports", () => {
    const { mutate, calls } = recorder();
    afterImportDraftChange(mutate);

    expect(calls.map((call) => [call.keys, call.options])).toEqual([[["/api/imports"], undefined]]);
  });

  it("afterExpenseDeleted removes the expense from every month ledger, then refreshes derived views", async () => {
    const { mutate, calls } = recorder();
    await afterExpenseDeleted(mutate, "e-1");

    expect(calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expenses?month=2026-10", "/api/expenses?month=2026-09&context=main"], NO_REVALIDATE],
      [["/api/expense-tabs/tab-1/expenses?revision=r1", "/api/expense-tabs/tab-2/expenses?revision=r2"], undefined],
      [["/api/dashboard?period=1m&granularity=day&date=2026-10-14"], undefined],
    ]);
    const update = calls[0].data as (current?: ExpensesData) => ExpensesData | undefined;
    const untouched = { expenses: [{ id: "e-9", amount: 5 }], total: 5, average: 5 } as ExpensesData;
    expect(update(untouched)).toBe(untouched);
    expect(update({ expenses: [{ id: "e-1", amount: 10 }], total: 10, average: 10 } as ExpensesData))
      .toMatchObject({ expenses: [], total: 0, average: 0 });
  });

  it("afterTabSaved upserts the tab and refreshes only an edited tab's ledgers", async () => {
    const created = recorder();
    await afterTabSaved(created.mutate, tab, { editing: false });
    expect(created.calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expense-tabs"], NO_REVALIDATE],
    ]);
    const append = created.calls[0].data as (current?: { tabs: ExpenseTab[] }) => { tabs: ExpenseTab[] };
    expect(append(undefined)).toEqual({ tabs: [tab] });

    const edited = recorder();
    await afterTabSaved(edited.mutate, tab, { editing: true });
    expect(edited.calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expense-tabs"], NO_REVALIDATE],
      [["/api/expense-tabs/tab-1/expenses?revision=r1"], undefined],
    ]);
    const replace = edited.calls[0].data as (current?: { tabs: ExpenseTab[] }) => { tabs: ExpenseTab[] };
    expect(replace({ tabs: [{ id: "tab-1", name: "Old" } as ExpenseTab] })).toEqual({ tabs: [tab] });
  });

  it("afterTabDeleted drops the tab and refreshes its ledgers", async () => {
    const { mutate, calls } = recorder();
    await afterTabDeleted(mutate, "tab-1");
    expect(calls.map((call) => [call.keys, call.options])).toEqual([
      [["/api/expense-tabs"], NO_REVALIDATE],
      [["/api/expense-tabs/tab-1/expenses?revision=r1"], undefined],
    ]);
    const update = calls[0].data as (current?: { tabs: ExpenseTab[] }) => { tabs: ExpenseTab[] } | undefined;
    expect(update(undefined)).toBeUndefined();
    expect(update({ tabs: [tab] })).toEqual({ tabs: [] });
  });

  it("afterInvestmentChange refreshes investments, net worth and the optional transactions key", async () => {
    const withDetail = recorder();
    await afterInvestmentChange(withDetail.mutate, "/api/investment-transactions?accountId=a");
    expect(withDetail.calls.map((call) => call.keys)).toEqual([
      ["/api/investments"],
      ["/api/net-worth"],
      ["/api/investment-transactions?accountId=a"],
    ]);

    const without = recorder();
    await afterInvestmentChange(without.mutate);
    expect(without.calls.map((call) => call.keys)).toEqual([["/api/investments"], ["/api/net-worth"]]);
  });

  it("single-key helpers revalidate their key; sign-out clears everything without refetching", async () => {
    const netWorth = recorder();
    await afterNetWorthChange(netWorth.mutate);
    expect(netWorth.calls.map((call) => call.keys)).toEqual([["/api/net-worth"]]);

    const signIn = recorder();
    await afterSignIn(signIn.mutate);
    expect(signIn.calls.map((call) => call.keys)).toEqual([["/api/account"]]);

    const passwordChange = recorder();
    await afterPasswordChange(passwordChange.mutate);
    expect(passwordChange.calls.map((call) => call.keys)).toEqual([["/api/account"]]);
    const clearFlag = passwordChange.calls[0].data as (current?: AccountData) => AccountData | undefined;
    const account: AccountData = {
      email: "kid@example.test",
      currency: "RON",
      features: { family: true },
      membership: null,
      mustChangePassword: true,
      avatarUrl: null,
    };
    expect(clearFlag(account)).toEqual({ ...account, mustChangePassword: false });
    expect(clearFlag(undefined)).toBeUndefined();

    const signOut = recorder();
    await afterSignOut(signOut.mutate);
    expect(signOut.calls).toEqual([{ keys: CACHED_KEYS, data: undefined, options: NO_REVALIDATE }]);
  });

  it("clears the password flag in SWR's cache even when no hook reads the account", async () => {
    // `/change-password` mounts no account hook, so a plain revalidation would leave the stale flag behind.
    const account: AccountData = {
      email: "kid@example.test",
      currency: "RON",
      features: { family: true },
      membership: null,
      mustChangePassword: true,
      avatarUrl: null,
    };
    await globalMutate("/api/account", account, { revalidate: false });

    await afterPasswordChange(globalMutate);

    expect(await globalMutate("/api/account")).toEqual({ ...account, mustChangePassword: false });
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
});
