import type { Cache, ScopedMutator } from "swr";
import { describe, expect, it, vi } from "vitest";

import { addExpenseOptimistically, ownLedgerMonth } from "@/components/expenses/use-expense-writes";
import type { DashboardData, Expense, ExpensesData } from "@/lib/expenses/types";
import type { ExpenseInput } from "@/lib/validation/expense";
import { anExpense } from "@/test/builders";

const OCTOBER = "/api/expenses?month=2026-10";
const OCTOBER_MAIN = "/api/expenses?month=2026-10&context=main";
const SEPTEMBER = "/api/expenses?month=2026-09";
const MEMBER = "/api/expenses?month=2026-10&member=m-2";
const HOME = "/api/dashboard?period=3m&granularity=month&date=";
const TAB = "/api/expense-tabs/tab-1/expenses?revision=r1";

const rent = anExpense({ id: "rent", description: "Rent", amount: 900, expenseDate: "2026-10-01" });
const ledger = (expenses: Expense[], month = "2026-10"): ExpensesData => {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return { month, expenses, total, average: total / expenses.length };
};
const home: DashboardData = {
  currentMonth: "2026-10",
  currentExpenses: [rent],
  currentTotal: 900,
  currentCount: 1,
  currentAverage: 900,
  currentLargest: 900,
  analytics: { label: "", total: 0, count: 0, monthlyAverage: 0, topCategory: "", categoryTotals: [], series: [] },
};

/** An SWR cache with the global mutate's semantics for what these writes use: a key or a filter, data or an updater. */
function swrCache(entries: Record<string, unknown>) {
  const store = new Map<string, { data?: unknown }>(Object.entries(entries).map(([key, data]) => [key, { data }]));
  const revalidated: string[] = [];
  const mutate = vi.fn(async (...args: [key: unknown, data?: unknown, options?: { revalidate?: boolean }]) => {
    const [key, data, options] = args;
    const keys = typeof key === "function" ? [...store.keys()].filter((cached) => (key as (value: string) => boolean)(cached)) : [key as string];
    for (const cached of keys) {
      // `mutate(key)` alone revalidates; with data (even undefined, a rollback) it writes.
      if (args.length > 1) {
        const next = typeof data === "function" ? (data as (current: unknown) => unknown)(store.get(cached)?.data) : data;
        store.set(cached, { data: next });
      }
      if (args.length === 1 || options?.revalidate !== false) revalidated.push(cached);
    }
  });
  return { cache: store as unknown as Cache, mutate: mutate as unknown as ScopedMutator, data: (key: string) => store.get(key)?.data, revalidated };
}

const input: ExpenseInput = { description: "Coffee", amount: 3.5, category: "entertainment", subtype: null, expenseDate: "2026-10-04", notes: "" };
const stored = anExpense({ id: "coffee", ...input, notes: null });

describe("ownLedgerMonth", () => {
  it("reads the month of the caller's own ledgers only", () => {
    expect(ownLedgerMonth(OCTOBER)).toBe("2026-10");
    expect(ownLedgerMonth(OCTOBER_MAIN)).toBe("2026-10");
    expect(ownLedgerMonth(MEMBER)).toBeNull();
    expect(ownLedgerMonth("/api/expenses/suggestions?q=co")).toBeNull();
  });
});

describe("addExpenseOptimistically", () => {
  const seeded = () => swrCache({
    [OCTOBER]: ledger([rent]),
    [OCTOBER_MAIN]: ledger([rent]),
    [SEPTEMBER]: ledger([], "2026-09"),
    [MEMBER]: ledger([]),
    [HOME]: home,
    [TAB]: { expenses: [] },
  });

  it("shows the expense in its month's ledgers and on Home before the server answers", async () => {
    const swr = seeded();
    let answer!: (expense: Expense) => void;
    const create = vi.fn(() => new Promise<Expense>((resolve) => (answer = resolve)));

    const saving = addExpenseOptimistically({ ...swr, create, input, pendingId: "pending-1" });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    for (const key of [OCTOBER, OCTOBER_MAIN]) {
      expect(swr.data(key)).toMatchObject({ expenses: [{ id: "pending-1", description: "Coffee" }, { id: "rent" }], total: 903.5 });
    }
    expect(swr.data(HOME)).toMatchObject({ currentExpenses: [{ id: "pending-1" }, { id: "rent" }], currentTotal: 903.5, currentCount: 2 });
    // Another month and a member's ledger aren't guessed at.
    expect(swr.data(SEPTEMBER)).toMatchObject({ expenses: [] });
    expect(swr.data(MEMBER)).toMatchObject({ expenses: [] });

    answer(stored);
    await saving;
  });

  it("swaps in the stored expense, then refreshes what the server works out", async () => {
    const swr = seeded();

    expect(await addExpenseOptimistically({ ...swr, create: async () => stored, input, pendingId: "pending-1" })).toEqual(stored);

    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "coffee" }, { id: "rent" }], total: 903.5 });
    expect(swr.data(HOME)).toMatchObject({ currentExpenses: [{ id: "coffee" }, { id: "rent" }], currentTotal: 903.5, currentCount: 2 });
    expect(swr.revalidated).toEqual(expect.arrayContaining([TAB, HOME, MEMBER]));
    expect(swr.revalidated).not.toContain(OCTOBER);
  });

  it("rolls every view back and throws when the server refuses", async () => {
    const swr = seeded();
    const refusal = new Error("Couldn't save. Try again.");

    await expect(addExpenseOptimistically({ ...swr, create: async () => { throw refusal; }, input, pendingId: "pending-1" })).rejects.toBe(refusal);

    expect(swr.data(OCTOBER)).toEqual(ledger([rent]));
    expect(swr.data(OCTOBER_MAIN)).toEqual(ledger([rent]));
    expect(swr.data(HOME)).toEqual(home);
    expect(swr.revalidated).toEqual([]);
  });

  it("leaves Home alone for an expense dated in another month", async () => {
    const swr = seeded();

    await addExpenseOptimistically({ ...swr, create: async () => ({ ...stored, expenseDate: "2026-09-30" }), input: { ...input, expenseDate: "2026-09-30" }, pendingId: "p" });

    expect(swr.data(HOME)).toMatchObject({ currentCount: 1 });
    expect(swr.data(SEPTEMBER)).toMatchObject({ expenses: [{ id: "coffee" }] });
  });
});
