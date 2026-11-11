"use client";

import { Stack } from "@chakra-ui/react";
import { useSearchParams } from "next/navigation";

import { ExpenseTabDashboard } from "@/components/dashboard/expense-tab-dashboard";
import { ExpenseList } from "@/components/expenses/expense-list";
import type { ExpenseRowActions } from "@/components/expenses/expense-rows";
import { ExpenseTabFiltersForm } from "@/components/expenses/expense-tab-filters";
import { Card } from "@/components/ui/card";
import { DataError, DataRefresh } from "@/components/ui/data-state";
import { RowsCardSkeleton } from "@/components/ui/skeletons";
import { useViewing } from "@/hooks/use-viewing";
import { expenseTabExpensesApiKey } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";
import { expenseTabFilterParams, readExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab, ExpenseTabLedgerData } from "@/lib/expenses/tabs";

/**
 * A saved tab: its matching expenses across all of history, its figures and charts, then the rows.
 * The tab's filters (dates, search, category, subtype) sit behind the Filters chip, so the figures
 * come first on a phone. Editing and deleting the tab are in the screen's `⋯`.
 */
export function CustomExpenseTab({
  tab,
  currency,
  filtersOpen,
  actions,
}: {
  tab: ExpenseTab;
  currency: string;
  filtersOpen: boolean;
  actions?: ExpenseRowActions;
}) {
  const searchParams = useSearchParams();
  const filters = readExpenseTabFilters(searchParams);
  const viewing = useViewing();
  const key = expenseTabExpensesApiKey(tab.id, filters, tab.updatedAt, viewing.member);
  const { data, error, isValidating, mutate } = useServerFirstSWR<ExpenseTabLedgerData>(viewing.ready ? key : null, { keepPreviousData: false });
  const filtersMatch = data && expenseTabFilterParams(data.filters).toString() === expenseTabFilterParams(filters).toString();
  const ledger = data?.tab.id === tab.id && data.tab.updatedAt === tab.updatedAt && filtersMatch ? data : undefined;

  return (
    <Stack gap="3">
      {filtersOpen ? (
        <Card>
          <ExpenseTabFiltersForm key={`${tab.id}:${JSON.stringify(filters)}`} tabId={tab.id} filters={filters} />
        </Card>
      ) : null}
      {!ledger ? (
        error ? <DataError retry={() => void mutate()} /> : <RowsCardSkeleton label={`Loading ${tab.name} expenses…`} slowKey={key} />
      ) : (
        <>
          <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
          <Card>
            <Card.Body>
              <ExpenseTabDashboard ledger={ledger} currency={currency} />
            </Card.Body>
          </Card>
          <Card>
            <Card.Header title="Matching expenses" description="Across your recorded history" />
            <Card.Body>
              <ExpenseList expenses={ledger.expenses} currency={currency} actions={actions} filtered emptyHint={null} />
            </Card.Body>
          </Card>
        </>
      )}
    </Stack>
  );
}
