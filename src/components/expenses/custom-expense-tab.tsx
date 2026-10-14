"use client";

import { Box, Button, Stack } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { ExpenseTabDashboard } from "@/components/dashboard/expense-tab-dashboard";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpenseTabFiltersForm } from "@/components/expenses/expense-tab-filters";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { SectionHeader } from "@/components/ui/section-header";
import { ApiError, apiRequest } from "@/lib/api/client";
import { afterTabDeleted } from "@/lib/api/invalidate";
import { expenseTabApiKey, expenseTabExpensesApiKey } from "@/lib/api/keys";
import { expenseTabFilterParams, readExpenseTabFilters } from "@/lib/expenses/filters";
import type { ExpenseTab, ExpenseTabLedgerData } from "@/lib/expenses/tabs";

export function CustomExpenseTab({
  tab,
  active,
  currency,
  onEdit,
  onDeleted,
}: {
  tab: ExpenseTab;
  active: boolean;
  currency: string;
  onEdit: (tab: ExpenseTab) => void;
  onDeleted: () => void;
}) {
  const searchParams = useSearchParams();
  const filters = readExpenseTabFilters(searchParams);
  const key = expenseTabExpensesApiKey(tab.id, filters, tab.updatedAt);
  const { data, error, isValidating, mutate } = useSWR<ExpenseTabLedgerData>(
    active ? key : null,
    { keepPreviousData: false },
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const { mutate: mutateCache } = useSWRConfig();
  const filtersMatch = data &&
    expenseTabFilterParams(data.filters).toString() === expenseTabFilterParams(filters).toString();
  const matching = active && data?.tabId === tab.id && data.tabRevision === tab.updatedAt &&
    filtersMatch
    ? data
    : undefined;

  async function deleteTab() {
    setDeletePending(true);
    setDeleteError("");
    try {
      await apiRequest<{ success: true }>(expenseTabApiKey(tab.id), { method: "DELETE" });
      await afterTabDeleted(mutateCache, tab.id);
      setDeleteOpen(false);
      onDeleted();
    } catch (caught) {
      setDeleteError(caught instanceof ApiError ? caught.message : "Unable to delete this tab.");
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <Stack gap="4">
      <SectionHeader
        title={tab.name}
        meta="All matching expenses across your recorded history."
        actions={
          <>
            <Button size="xs" variant="outline" onClick={() => onEdit(tab)}>
              <Pencil size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Edit tab
            </Button>
            <Button size="xs" variant="outline" colorPalette="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Delete tab
            </Button>
          </>
        }
      />

      <Card overflow="hidden">
        <ExpenseTabFiltersForm
          key={`${tab.id}:${JSON.stringify(filters)}`}
          tabId={tab.id}
          filters={filters}
        />
        {error && !matching ? (
          <DataError retry={() => void mutate()} />
        ) : !matching ? (
          <Box p="4"><DataLoading layout="section" label={`Loading ${tab.name} expenses…`} /></Box>
        ) : (
          <Stack gap="4" p="4">
            <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
            <ExpenseTabDashboard ledger={matching} currency={currency} />
          </Stack>
        )}
      </Card>

      {matching ? (
        <Card overflow="hidden">
          <Card.Header title="Matching expenses" />
          <Box mt="3" borderTopWidth="1px" borderColor="border">
            <ExpenseList
              expenses={matching.expenses}
              currency={currency}
              allowDelete
              filterMode="external"
            />
          </Box>
        </Card>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this tab?"
        description={`“${tab.name}” will be removed from your saved tabs. Your expenses stay in the main ledger.`}
        cancelLabel="Keep tab"
        confirmLabel="Delete tab"
        pending={deletePending}
        error={deleteError}
        onConfirm={() => void deleteTab()}
      />
    </Stack>
  );
}
