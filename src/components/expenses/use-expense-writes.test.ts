import type { Cache, ScopedMutator } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXPENSE_DELETE, writeOptimistically } from "@/components/expenses/use-expense-writes";
import { createUndoQueue, deleteWithUndo, type UndoEntry } from "@/components/ui/undo-toast";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import type { DashboardData, Expense, ExpensesData, FamilyExpensesData } from "@/lib/expenses/types";
import { aTab, anExpense } from "@/test/builders";

const OCTOBER = "/api/expenses?month=2026-10";
const SEPTEMBER = "/api/expenses?month=2026-09";
const MEMBER = "/api/expenses?month=2026-10&member=m-2";
const FAMILY = "/api/expenses?month=2026-10&member=all";
const HOME = "/api/dashboard?period=3m&granularity=month&date=";
const TAB = "/api/expense-tabs/tab-1/expenses?revision=r1";

const rent = anExpense({ id: "rent", description: "Rent", amount: 900, expenseDate: "2026-10-01" });
const coffee = anExpense({ id: "coffee", description: "Coffee", amount: 3.5, category: "entertainment", expenseDate: "2026-10-04" });
const ledger = (expenses: Expense[], month = "2026-10"): ExpensesData => {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return { month, expenses, total, average: expenses.length ? total / expenses.length : 0 };
};
const home: DashboardData = {
  currentMonth: "2026-10",
  currentExpenses: [coffee, rent],
  currentTotal: 903.5,
  currentCount: 2,
  currentAverage: 451.75,
  currentLargest: 900,
  analytics: { label: "", total: 0, count: 0, monthlyAverage: 0, topCategory: "", categoryTotals: [], series: [] },
};
const family: FamilyExpensesData = {
  month: "2026-10",
  expenses: [{ ...rent, memberId: "m-1", memberName: "George", currency: "EUR" }],
  totals: [{ currency: "EUR", total: 900, count: 1, average: 900, largest: 900 }],
  viewing: { memberId: "all", displayName: null, currency: null, readOnly: true },
};
const tabLedger: ExpenseTabLedgerData = {
  tab: aTab({ id: "tab-1" }),
  filters: DEFAULT_EXPENSE_TAB_FILTERS,
  expenses: [rent],
  total: 900,
  count: 1,
  average: 900,
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

const seeded = () => swrCache({
  [OCTOBER]: ledger([coffee, rent]),
  [SEPTEMBER]: ledger([], "2026-09"),
  [MEMBER]: ledger([]),
  [FAMILY]: family,
  [HOME]: home,
  [TAB]: tabLedger,
});

/** A write that waits for `answer` (or `refuse`), so the optimistic state can be looked at first. */
function deferred<T>() {
  let answer!: (value: T) => void;
  let refuse!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    answer = resolve;
    refuse = reject;
  });
  return { write: vi.fn(() => promise), answer, refuse };
}

describe("an optimistic add", () => {
  const pending = anExpense({ id: "pending-1", description: "Lunch", amount: 12, expenseDate: "2026-10-05" });
  const stored = { ...pending, id: "lunch" };

  it("shows the expense in its month's ledger and on Home before the server answers, then swaps in the stored one", async () => {
    const swr = seeded();
    const server = deferred<Expense>();

    const saving = writeOptimistically({ ...swr, change: { added: pending }, write: server.write, settled: (expense) => ({ removed: pending, added: expense }) });
    await vi.waitFor(() => expect(server.write).toHaveBeenCalled());

    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "pending-1" }, { id: "coffee" }, { id: "rent" }], total: 915.5 });
    expect(swr.data(HOME)).toMatchObject({ currentExpenses: [{ id: "pending-1" }, { id: "coffee" }, { id: "rent" }], currentTotal: 915.5, currentCount: 3 });
    expect(swr.data(SEPTEMBER)).toEqual(ledger([], "2026-09"));

    server.answer(stored);
    expect(await saving).toEqual(stored);
    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "lunch" }, { id: "coffee" }, { id: "rent" }], total: 915.5 });
    expect(swr.data(HOME)).toMatchObject({ currentTotal: 915.5, currentCount: 3 });
  });

  it("rolls every view back and throws when the server refuses", async () => {
    const swr = seeded();
    const refusal = new Error("Couldn't save. Try again.");

    await expect(writeOptimistically({ ...swr, change: { added: pending }, write: async () => { throw refusal; } })).rejects.toBe(refusal);

    expect(swr.data(OCTOBER)).toEqual(ledger([coffee, rent]));
    expect(swr.data(HOME)).toEqual(home);
    expect(swr.revalidated).toEqual([]);
  });
});

describe("an optimistic edit", () => {
  it("changes the row at once and recounts the month", async () => {
    const swr = seeded();
    const edited = { ...coffee, amount: 4.5 };
    const server = deferred<Expense>();

    const saving = writeOptimistically({ ...swr, change: { removed: coffee, added: edited }, write: server.write, settled: (expense) => ({ removed: edited, added: expense }) });
    await vi.waitFor(() => expect(server.write).toHaveBeenCalled());

    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "coffee", amount: 4.5 }, { id: "rent" }], total: 904.5 });
    expect(swr.data(HOME)).toMatchObject({ currentTotal: 904.5, currentCount: 2 });
    server.answer(edited);
    await saving;
    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "coffee", amount: 4.5 }, { id: "rent" }], total: 904.5 });
  });

  it("moves an expense given another month's date to that month's ledger (its date decides its month)", async () => {
    const swr = seeded();
    const moved = { ...coffee, expenseDate: "2026-09-30" };

    await writeOptimistically({ ...swr, change: { removed: coffee, added: moved }, write: async () => moved, settled: (expense) => ({ removed: moved, added: expense }) });

    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "rent" }], total: 900 });
    expect(swr.data(SEPTEMBER)).toMatchObject({ expenses: [{ id: "coffee" }], total: 3.5 });
    expect(swr.data(HOME)).toMatchObject({ currentTotal: 900, currentCount: 1, currentExpenses: [{ id: "rent" }] });
  });

  it("puts the row back as it was when the server refuses", async () => {
    const swr = seeded();

    await expect(writeOptimistically({ ...swr, change: { removed: coffee, added: { ...coffee, amount: 99 } }, write: async () => { throw new Error("no"); } })).rejects.toThrow("no");

    expect(swr.data(OCTOBER)).toEqual(ledger([coffee, rent]));
    expect(swr.data(HOME)).toEqual(home);
  });
});

describe("an optimistic delete", () => {
  it("takes the row out of the month, Home and the saved-tab ledgers before the server answers", async () => {
    const swr = seeded();
    const server = deferred<void>();

    const deleting = writeOptimistically({ ...swr, change: { removed: rent }, write: server.write });
    await vi.waitFor(() => expect(server.write).toHaveBeenCalled());

    expect(swr.data(OCTOBER)).toMatchObject({ expenses: [{ id: "coffee" }], total: 3.5, average: 3.5 });
    expect(swr.data(HOME)).toMatchObject({ currentExpenses: [{ id: "coffee" }], currentTotal: 3.5, currentCount: 1 });
    expect(swr.data(TAB)).toMatchObject({ expenses: [], total: 0, count: 0, average: 0 });
    server.answer();
    await deleting;
  });

  it("brings the row back everywhere when the server refuses", async () => {
    const swr = seeded();

    await expect(writeOptimistically({ ...swr, change: { removed: rent }, write: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");

    expect(swr.data(OCTOBER)).toEqual(ledger([coffee, rent]));
    expect(swr.data(HOME)).toEqual(home);
    expect(swr.data(TAB)).toEqual(tabLedger);
  });

  // Audit B4: the family view's totals are per member and per currency, so it is refetched, not edited.
  it("leaves the family and member views as they were and refetches them", async () => {
    const swr = seeded();

    await writeOptimistically({ ...swr, change: { removed: rent }, write: async () => undefined });

    expect(swr.data(FAMILY)).toBe(family);
    expect(swr.data(MEMBER)).toEqual(ledger([]));
    expect(swr.revalidated).toEqual(expect.arrayContaining([FAMILY, MEMBER, TAB, HOME]));
    expect(swr.revalidated).not.toContain(OCTOBER);
  });
});

describe("deleteWithUndo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setUp(remove: (expense: Expense) => Promise<unknown> = async () => undefined) {
    const shown: (UndoEntry | null)[] = [];
    const queue = createUndoQueue({ delay: 5000, onChange: (entry) => shown.push(entry) });
    const hidden = new Set<string>();
    const failures: string[] = [];
    const removeSpy = vi.fn(remove);
    deleteWithUndo(queue.schedule, rent, {
      ...EXPENSE_DELETE,
      hide: (id, hiding) => (hiding ? hidden.add(id) : hidden.delete(id)),
      remove: removeSpy,
      onFailure: (message) => failures.push(message),
    });
    return { queue, shown, hidden, failures, remove: removeSpy };
  }

  it("hides the row and shows Expense deleted, sending nothing yet", () => {
    const { shown, hidden, remove } = setUp();

    expect(hidden.has("rent")).toBe(true);
    expect(shown.at(-1)?.message).toBe("Expense deleted");
    expect(remove).not.toHaveBeenCalled();
  });

  it("cancels the delete on Undo: the row comes back and no request is sent", async () => {
    const { queue, hidden, remove } = setUp();

    queue.undo();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(hidden.has("rent")).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("sends the delete when the toast expires", async () => {
    const { hidden, remove } = setUp();

    await vi.advanceTimersByTimeAsync(5000);

    expect(remove).toHaveBeenCalledWith(rent);
    expect(hidden.has("rent")).toBe(false);
  });

  it("brings the row back and says so when the delete fails", async () => {
    const { hidden, failures } = setUp(async () => { throw new Error("offline"); });

    await vi.advanceTimersByTimeAsync(5000);

    expect(hidden.has("rent")).toBe(false);
    expect(failures).toEqual(["Couldn't delete “Rent”. Try again."]);
  });
});
