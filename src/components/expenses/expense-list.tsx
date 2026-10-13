"use client";

import { Inbox, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { ExpenseFilters } from "@/components/expenses/expense-filters";
import { ExpenseMobileList } from "@/components/expenses/expense-mobile-list";
import { ExpenseTable } from "@/components/expenses/expense-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SUBTYPE_LABELS } from "@/lib/expenses/categories";
import { CATEGORY_LABELS, type Expense, type ExpenseCategory } from "@/lib/types";

function NoExpenses({ filtered = false }: { filtered?: boolean }) {
  return (
    <EmptyState
      size="sm"
      icon={filtered ? <Search /> : <Inbox />}
      title={filtered ? "No matching expenses" : "No recorded expenses"}
      description={
        filtered
          ? "Try another search or choose a different category."
          : "Add your first expense to start building this month’s picture."
      }
    />
  );
}

export function ExpenseList({
  expenses,
  currency,
  compact = false,
  allowDelete = false,
  filterMode = "internal",
}: {
  expenses: Expense[];
  currency: string;
  compact?: boolean;
  allowDelete?: boolean;
  filterMode?: "internal" | "external";
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "all">("all");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const filtered = useMemo(() => {
    if (compact) return expenses.slice(0, 5);
    if (filterMode === "external") return expenses;

    return expenses.filter((expense) => {
      const categoryMatches = category === "all" || expense.category === category;
      const queryMatches =
        !deferredQuery ||
        expense.description.toLocaleLowerCase().includes(deferredQuery) ||
        expense.notes?.toLocaleLowerCase().includes(deferredQuery) ||
        CATEGORY_LABELS[expense.category].toLocaleLowerCase().includes(deferredQuery) ||
        (expense.subtype && SUBTYPE_LABELS[expense.subtype].toLocaleLowerCase().includes(deferredQuery));
      return categoryMatches && Boolean(queryMatches);
    });
  }, [category, compact, deferredQuery, expenses, filterMode]);

  if (!expenses.length) return <NoExpenses filtered={filterMode === "external"} />;

  return (
    <>
      {compact || filterMode === "external" ? null : (
        <ExpenseFilters
          query={query}
          onQueryChange={setQuery}
          category={category}
          onCategoryChange={setCategory}
          shown={filtered.length}
          total={expenses.length}
        />
      )}
      {!filtered.length ? <NoExpenses filtered /> : (
        <>
          <ExpenseTable expenses={filtered} currency={currency} allowDelete={allowDelete} />
          <ExpenseMobileList expenses={filtered} currency={currency} allowDelete={allowDelete} />
        </>
      )}
    </>
  );
}
