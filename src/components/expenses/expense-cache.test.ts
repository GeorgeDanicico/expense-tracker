import type { ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import {
  afterExpenseLogged,
  afterImportChange,
  afterImportDraftChange,
  applyExpenseChange,
  ownLedgerMonth,
  withoutTab,
  withTabSaved,
} from "@/components/expenses/expense-cache";
import type { ExpensesData } from "@/lib/expenses/types";
import { aTab, anExpense } from "@/test/builders";

const CACHED_KEYS = [
  "/api/account",
  "/api/expense-tabs",
  "/api/expense-tabs/tab-1/expenses?revision=r1",
  "/api/dashboard?period=1m&granularity=day&date=2026-10-14",
  "/api/imports",
  "/api/expenses?month=2026-10",
  "/api/expenses?month=2026-10&member=all",
  "/api/expenses/suggestions?q=co",
];

/** The cached keys each mutate call reaches, in order. */
function recorder() {
  const calls: string[][] = [];
  const mutate = vi.fn((key: unknown) => {
    calls.push(typeof key === "function" ? CACHED_KEYS.filter((cached) => (key as (value: string) => boolean)(cached)) : [key as string]);
    return Promise.resolve(undefined);
  });
  return { mutate: mutate as unknown as ScopedMutator, reached: () => [...new Set(calls.flat())].sort() };
}

describe("ownLedgerMonth", () => {
  it("reads the month of the caller's own ledgers only", () => {
    expect(ownLedgerMonth("/api/expenses?month=2026-10")).toBe("2026-10");
    expect(ownLedgerMonth("/api/expenses?month=2026-10&member=m-2")).toBeNull();
    expect(ownLedgerMonth("/api/expenses?month=2026-10&member=all")).toBeNull();
    expect(ownLedgerMonth("/api/expenses/suggestions?q=co")).toBeNull();
  });
});

describe("applyExpenseChange", () => {
  const rent = anExpense({ id: "rent", amount: 900, expenseDate: "2026-10-01" });
  const october: ExpensesData = { month: "2026-10", expenses: [rent], total: 900, average: 900 };

  it("returns the cached object itself when the change doesn't touch it, so nothing is rewritten", () => {
    const september = anExpense({ id: "x", expenseDate: "2026-09-02" });
    expect(applyExpenseChange("/api/expenses?month=2026-10", october, { added: september })).toBe(october);
    expect(applyExpenseChange("/api/expenses?month=2026-10&member=all", october, { removed: rent })).toBe(october);
    expect(applyExpenseChange("/api/account", { currency: "EUR" }, { removed: rent })).toEqual({ currency: "EUR" });
  });

  it("recounts a ledger left empty to zero", () => {
    expect(applyExpenseChange("/api/expenses?month=2026-10", october, { removed: rent })).toEqual({ month: "2026-10", expenses: [], total: 0, average: 0 });
  });
});

describe("refetching after writes made elsewhere", () => {
  it("afterExpenseLogged refetches every ledger (the family's too), the tab ledgers, the dashboards and the suggestions", () => {
    const { mutate, reached } = recorder();
    afterExpenseLogged(mutate);

    expect(reached()).toEqual([
      "/api/dashboard?period=1m&granularity=day&date=2026-10-14",
      "/api/expense-tabs/tab-1/expenses?revision=r1",
      "/api/expenses/suggestions?q=co",
      "/api/expenses?month=2026-10",
      "/api/expenses?month=2026-10&member=all",
    ]);
  });

  it("afterImportChange also refetches the recent imports; afterImportDraftChange only those", () => {
    const changed = recorder();
    afterImportChange(changed.mutate);
    expect(changed.reached()).toContain("/api/imports");
    expect(changed.reached()).toContain("/api/expenses?month=2026-10");

    const draft = recorder();
    afterImportDraftChange(draft.mutate);
    expect(draft.reached()).toEqual(["/api/imports"]);
  });
});

describe("the saved-tab list", () => {
  const car = aTab({ id: "tab-1", name: "Car" });

  it("adds a new tab at the end and replaces an edited one in place", () => {
    const home = aTab({ id: "tab-2", name: "Home" });
    expect(withTabSaved(undefined, car)).toEqual({ tabs: [car] });
    expect(withTabSaved({ tabs: [car] }, home)).toEqual({ tabs: [car, home] });
    expect(withTabSaved({ tabs: [car, home] }, { ...car, name: "Cars" })).toEqual({ tabs: [{ ...car, name: "Cars" }, home] });
  });

  it("drops a deleted tab, and leaves an unloaded list unloaded", () => {
    expect(withoutTab({ tabs: [car] }, "tab-1")).toEqual({ tabs: [] });
    expect(withoutTab(undefined, "tab-1")).toBeUndefined();
  });
});
