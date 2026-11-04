"use client";

import { Inbox, Search } from "lucide-react";

import { ExpenseRows, type ExpenseRowActions } from "@/components/expenses/expense-rows";
import { EmptyState } from "@/components/ui/empty-state";
import type { ListedExpense } from "@/lib/expenses/types";

/**
 * An expense list grouped by day, with its empty states. `filtered` says the rows were narrowed (the
 * ledger's Filters, a saved tab's filters), for the empty state's wording. `limit` keeps the newest
 * few (Insights' recent expenses).
 */
export function ExpenseList({
  expenses,
  currency,
  actions,
  filtered = false,
  limit,
  emptyHint = "Tap + to add one.",
}: {
  expenses: readonly ListedExpense[];
  currency: string;
  actions?: ExpenseRowActions;
  filtered?: boolean;
  limit?: number;
  /** What to say under "No recorded expenses"; nothing while read-only. */
  emptyHint?: string | null;
}) {
  const shown = limit ? expenses.slice(0, limit) : expenses;
  if (!shown.length) {
    return (
      <EmptyState
        size="sm"
        titleAs="p"
        icon={filtered ? <Search /> : <Inbox />}
        title={filtered ? "No matching expenses" : "No recorded expenses"}
        description={filtered ? "Try another search or choose a different category." : (emptyHint ?? undefined)}
      />
    );
  }
  return <ExpenseRows expenses={shown} currency={currency} actions={actions} />;
}
