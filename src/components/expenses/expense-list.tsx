"use client";

import { Inbox, Search } from "lucide-react";
import { useDeferredValue, useMemo } from "react";

import { ExpenseRows, type ExpenseRowActions } from "@/components/expenses/expense-rows";
import { EmptyState } from "@/components/ui/empty-state";
import type { ExpenseCategory } from "@/lib/expenses/categories";
import { matchesExpenseSearch } from "@/lib/expenses/filters";
import type { ListedExpense } from "@/lib/expenses/types";

/** The main ledger's search and category filter (behind the Filters chip). */
export type ExpenseListFilter = { query: string; category: ExpenseCategory | "all" };

export const NO_FILTER: ExpenseListFilter = { query: "", category: "all" };

/** The expenses `filter` keeps: the search in the description, notes, category or subtype, and the category. */
export function filterExpenses<T extends ListedExpense>(expenses: readonly T[], { query, category }: ExpenseListFilter) {
  const term = query.trim().toLocaleLowerCase();
  return expenses.filter((expense) => (category === "all" || expense.category === category) && (!term || matchesExpenseSearch(expense, term)));
}

/**
 * An expense list grouped by day, with its empty states. `filter` narrows it (the main ledger's
 * Filters); `filtered` says the rows were already narrowed elsewhere (a saved tab's filters), for the
 * empty state's wording. `limit` keeps the newest few (Insights' recent expenses).
 */
export function ExpenseList({
  expenses,
  currency,
  actions,
  filter = NO_FILTER,
  filtered = false,
  limit,
  emptyHint = "Tap + to add one.",
}: {
  expenses: readonly ListedExpense[];
  currency: string;
  actions?: ExpenseRowActions;
  filter?: ExpenseListFilter;
  filtered?: boolean;
  limit?: number;
  /** What to say under "No recorded expenses"; nothing while read-only. */
  emptyHint?: string | null;
}) {
  const deferred = useDeferredValue(filter);
  const shown = useMemo(() => {
    const kept = filterExpenses(expenses, deferred);
    return limit ? kept.slice(0, limit) : kept;
  }, [deferred, expenses, limit]);

  const narrowed = filtered || filter.query.trim() !== "" || filter.category !== "all";
  if (!shown.length) {
    return (
      <EmptyState
        size="sm"
        titleAs="p"
        icon={narrowed ? <Search /> : <Inbox />}
        title={narrowed ? "No matching expenses" : "No recorded expenses"}
        description={narrowed ? "Try another search or choose a different category." : (emptyHint ?? undefined)}
      />
    );
  }
  return <ExpenseRows expenses={shown} currency={currency} actions={actions} />;
}
