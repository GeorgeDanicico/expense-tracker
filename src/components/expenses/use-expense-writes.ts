"use client";

import { useCallback, useMemo, useRef } from "react";
import { useSWRConfig, type Cache, type ScopedMutator } from "swr";

import { useExpenseApi, type ExpenseApi } from "@/components/expenses/expense-api";
import { afterExpenseChange } from "@/lib/api/invalidate";
import type { DashboardData, Expense, ExpensesData } from "@/lib/expenses/types";
import type { ExpenseInput } from "@/lib/validation/expense";

/** The month of a cached `/api/expenses?month=…` ledger of the caller's own, or null for any other key. */
export function ownLedgerMonth(key: string) {
  if (!key.startsWith("/api/expenses?")) return null;
  const params = new URLSearchParams(key.slice(key.indexOf("?") + 1));
  return params.has("member") ? null : params.get("month");
}

/** Whether `key` is the caller's own dashboard (Home), not a member's or the family's. */
function isOwnDashboardKey(key: string) {
  return key.startsWith("/api/dashboard?") && !new URLSearchParams(key.slice(key.indexOf("?") + 1)).has("member");
}

/** A cached response that shows `expense` at once: its month's ledger, or the dashboard of its month. */
function showsExpense(key: string, expense: Expense, data: unknown) {
  const month = expense.expenseDate.slice(0, 7);
  if (ownLedgerMonth(key) === month) return true;
  return isOwnDashboardKey(key) && (data as DashboardData | undefined)?.currentMonth === month;
}

/** Newest first by date, as the lists sort; a new expense goes before others of its day. */
function byDate(expenses: Expense[]) {
  return expenses.toSorted((a, b) => b.expenseDate.localeCompare(a.expenseDate));
}

/** `current` (a month ledger or the dashboard) with `expense` added, or swapped for the one with `replacing`'s id. */
export function withExpense(current: unknown, expense: Expense, replacing?: string): unknown {
  if (!current || typeof current !== "object") return current;
  if ("expenses" in current) {
    const ledger = current as ExpensesData;
    const others = ledger.expenses.filter((item) => item.id !== (replacing ?? expense.id));
    const expenses = byDate([expense, ...others]);
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);
    return { ...ledger, expenses, total, average: total / expenses.length };
  }
  if ("currentExpenses" in current) {
    const dashboard = current as DashboardData;
    const replaced = replacing !== undefined && dashboard.currentExpenses.some((item) => item.id === replacing);
    const currentExpenses = byDate([expense, ...dashboard.currentExpenses.filter((item) => item.id !== replacing)]).slice(0, 5);
    if (replaced) return { ...dashboard, currentExpenses };
    const currentTotal = dashboard.currentTotal + expense.amount;
    const currentCount = dashboard.currentCount + 1;
    return {
      ...dashboard,
      currentExpenses,
      currentTotal,
      currentCount,
      currentAverage: currentTotal / currentCount,
      currentLargest: Math.max(dashboard.currentLargest, expense.amount),
    };
  }
  return current;
}

/** Every view a new expense changes that isn't updated by hand: members' and family views, tab ledgers, suggestions. */
function refreshDerivedViews(mutate: ScopedMutator) {
  afterExpenseChange(mutate);
  void mutate((key) => typeof key === "string" && key.startsWith("/api/expenses?") && ownLedgerMonth(key) === null);
  void mutate((key) => typeof key === "string" && key.startsWith("/api/expenses/suggestions?"));
}

/**
 * Adds an expense optimistically: it shows at once in every cached view of its month (the Expenses
 * ledger, the Monthly dashboard, Home), then the API is asked. On success the stored expense takes
 * its place and the views worked out on the server refetch; on failure every view goes back to what
 * it held and the error is thrown for the form to show.
 */
export async function addExpenseOptimistically({
  mutate,
  cache,
  create,
  input,
  pendingId,
}: {
  mutate: ScopedMutator;
  cache: Cache;
  create: ExpenseApi["create"];
  input: ExpenseInput;
  /** The id the expense shows with until it is stored. */
  pendingId: string;
}): Promise<Expense> {
  const pending: Expense = { id: pendingId, ...input, notes: input.notes || null };
  const keys = [...cache.keys()].filter((key) => showsExpense(key, pending, cache.get(key)?.data));
  const before = new Map(keys.map((key) => [key, cache.get(key)?.data]));
  await Promise.all(keys.map((key) => mutate(key, (current: unknown) => withExpense(current, pending), { revalidate: false })));
  try {
    const stored = await create(input);
    await Promise.all(keys.map((key) => mutate(key, (current: unknown) => withExpense(current, stored, pendingId), { revalidate: false })));
    refreshDerivedViews(mutate);
    return stored;
  } catch (caught) {
    await Promise.all(keys.map((key) => mutate(key, before.get(key), { revalidate: false })));
    throw caught;
  }
}

/** The expense writes, with their cache updates (audit D6). */
export function useExpenseWrites() {
  const api = useExpenseApi();
  const { mutate, cache } = useSWRConfig();
  const counter = useRef(0);
  const add = useCallback((input: ExpenseInput) => {
    counter.current += 1;
    return addExpenseOptimistically({ mutate, cache, create: api.create, input, pendingId: `pending-${counter.current}` });
  }, [api, cache, mutate]);
  return useMemo(() => ({ add }), [add]);
}
