"use client";

import { useMemo, useRef } from "react";
import { useSWRConfig, type Cache, type ScopedMutator } from "swr";

import { useExpenseApi } from "@/components/expenses/expense-api";
import { applyExpenseChange, refreshExpenseViews, withoutTab, withTabSaved, type ExpenseChange } from "@/components/expenses/expense-cache";
import { useDeleteWithUndo, type DeleteCopy } from "@/components/ui/undo-toast";
import { EXPENSE_TABS_API_KEY, expenseTabApiKey, type TabsResponse } from "@/lib/api/keys";
import type { ExpenseTab, ExpenseTabInput } from "@/lib/expenses/tabs";
import type { Expense } from "@/lib/expenses/types";
import type { ExpenseInput } from "@/lib/validation/expense";

type Swr = { mutate: ScopedMutator; cache: Cache };

/**
 * An optimistic write: `change` shows at once in every cached view it touches (the Expenses ledger,
 * Insights' Monthly, Home), then `write` is sent. On success `settled(result)` swaps in what the
 * server stored and the views worked out on the server refetch; on failure every touched view goes
 * back to what it held and the error is thrown for the screen to show.
 */
export async function writeOptimistically<T>({
  mutate,
  cache,
  change,
  write,
  settled,
}: Swr & {
  change: ExpenseChange;
  write: () => Promise<T>;
  settled?: (result: T) => ExpenseChange;
}): Promise<T> {
  const before = new Map<string, unknown>();
  for (const key of cache.keys()) {
    const data = cache.get(key)?.data;
    if (applyExpenseChange(key, data, change) !== data) before.set(key, data);
  }
  const keys = [...before.keys()];
  const update = (next: ExpenseChange) =>
    Promise.all(keys.map((key) => mutate(key, (current: unknown) => applyExpenseChange(key, current, next), { revalidate: false })));
  await update(change);
  try {
    const result = await write();
    if (settled) await update(settled(result));
    refreshExpenseViews(mutate);
    return result;
  } catch (caught) {
    await Promise.all(keys.map((key) => mutate(key, before.get(key), { revalidate: false })));
    throw caught;
  }
}

/** The expense as stored from what a form checked: empty notes are null. */
const asStored = (id: string, input: ExpenseInput): Expense => ({ id, ...input, notes: input.notes || null });

const isLedgerOfTab = (id: string) => (key: unknown) => typeof key === "string" && key.startsWith(`${expenseTabApiKey(id)}/expenses?`);

/**
 * The expense writes with their cache updates (audit D6): optimistic add, edit and delete, and the
 * saved tabs (which wait for the server, since it names a new tab). Only the caller's own views are
 * changed by hand; a member's or the family's view is refetched (audit B4).
 */
export function useExpenseWrites() {
  const api = useExpenseApi();
  const { mutate, cache } = useSWRConfig();
  const counter = useRef(0);

  return useMemo(() => {
    const swr = { mutate, cache };
    return {
      /** Shows the new expense at once, under a pending id until it is stored. */
      add(input: ExpenseInput) {
        counter.current += 1;
        const pending = asStored(`pending-${counter.current}`, input);
        return writeOptimistically({ ...swr, change: { added: pending }, write: () => api.create(input), settled: (stored) => ({ removed: pending, added: stored }) });
      },
      /** Shows the change at once: a new date moves the expense to that month's ledger. */
      edit(expense: Expense, input: ExpenseInput) {
        const edited = asStored(expense.id, input);
        return writeOptimistically({ ...swr, change: { removed: expense, added: edited }, write: () => api.update(expense.id, input), settled: (stored) => ({ removed: edited, added: stored }) });
      },
      /** Takes the expense out at once and deletes it; `useExpenseDelete` waits for Undo first. */
      remove(expense: Expense) {
        return writeOptimistically({ ...swr, change: { removed: expense }, write: () => api.remove(expense.id) });
      },
      async saveTab(input: ExpenseTabInput, tab?: ExpenseTab) {
        const saved = await api.saveTab(input, tab?.id);
        await mutate<TabsResponse>(EXPENSE_TABS_API_KEY, (current) => withTabSaved(current, saved), { revalidate: false });
        if (tab) void mutate(isLedgerOfTab(saved.id));
        return saved;
      },
      async removeTab(id: string) {
        await api.removeTab(id);
        await mutate<TabsResponse>(EXPENSE_TABS_API_KEY, (current) => withoutTab(current, id), { revalidate: false });
        void mutate(isLedgerOfTab(id));
      },
    };
  }, [api, cache, mutate]);
}

/** What the expense deletes say (`deleteWithUndo`). */
export const EXPENSE_DELETE: DeleteCopy<Expense> = {
  message: "Expense deleted",
  failure: (expense) => `Couldn't delete “${expense.description}”. Try again.`,
};

/**
 * The Expenses screen's deletes: `remove(expense)` hides the row and offers Undo (`deleteWithUndo`).
 * Lists leave out `hidden`; spread `toast` on an `UndoToast`.
 */
export function useExpenseDelete() {
  return useDeleteWithUndo(useExpenseWrites().remove, EXPENSE_DELETE);
}
