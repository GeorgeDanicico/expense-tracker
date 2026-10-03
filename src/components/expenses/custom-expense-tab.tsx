"use client";

import { Alert, Box, Button, Dialog, Flex, Heading, Portal, Stack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { ExpenseTabDashboard } from "@/components/dashboard/expense-tab-dashboard";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpenseTabFiltersForm } from "@/components/expenses/expense-tab-filters";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { ApiError, apiRequest } from "@/lib/api/client";
import { EXPENSE_TABS_API_KEY, expenseTabApiKey, expenseTabExpensesApiKey } from "@/lib/api/keys";
import { expenseTabFilterParams, readExpenseTabFilters } from "@/lib/frontend/expense-tab-state";
import type { ExpenseTab, ExpenseTabLedgerData } from "@/lib/expenses/tabs";

type TabsResponse = { tabs: ExpenseTab[] };

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
      await mutateCache(
        EXPENSE_TABS_API_KEY,
        (current: TabsResponse | undefined) => current
          ? { tabs: current.tabs.filter((item) => item.id !== tab.id) }
          : current,
        { revalidate: false },
      );
      void mutateCache((cacheKey) =>
        typeof cacheKey === "string" && cacheKey.startsWith(`${expenseTabApiKey(tab.id)}/expenses?`),
      );
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
      <Flex align={{ base: "stretch", sm: "center" }} justify="space-between" gap="3" wrap="wrap">
        <Stack gap="0.5">
          <Heading as="h2" size="lg">{tab.name}</Heading>
          <Text color="muted" fontSize="sm">All matching expenses across your recorded history.</Text>
        </Stack>
        <Flex gap="2" wrap="wrap">
          <Button variant="outline" borderRadius="xl" onClick={() => onEdit(tab)}>Edit tab</Button>
          <Button colorPalette="red" variant="outline" borderRadius="xl" onClick={() => setDeleteOpen(true)}>
            Delete tab
          </Button>
        </Flex>
      </Flex>

      <Surface overflow="hidden">
        <ExpenseTabFiltersForm
          key={`${tab.id}:${JSON.stringify(filters)}`}
          tabId={tab.id}
          filters={filters}
        />
        {error && !matching ? (
          <DataError retry={() => void mutate()} />
        ) : !matching ? (
          <DataLoading label={`Loading ${tab.name} expenses…`} />
        ) : (
          <Stack gap="5" p={{ base: "4", md: "5" }}>
            <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
            <ExpenseTabDashboard ledger={matching} currency={currency} />
            <Box overflow="hidden" borderWidth="1px" borderColor="border" borderRadius="2xl">
              <Box p="4" pb="0">
                <Heading as="h3" size="md">Matching expenses</Heading>
              </Box>
              <ExpenseList
                expenses={matching.expenses}
                currency={currency}
                allowDelete
                filterMode="external"
              />
            </Box>
          </Stack>
        )}
      </Surface>

      <DeleteExpenseTabDialog
        tab={tab}
        open={deleteOpen}
        pending={deletePending}
        error={deleteError}
        onOpenChange={setDeleteOpen}
        onDelete={() => void deleteTab()}
      />
    </Stack>
  );
}

function DeleteExpenseTabDialog({
  tab,
  open,
  pending,
  error,
  onOpenChange,
  onDelete,
}: {
  tab: ExpenseTab;
  open: boolean;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(details) => onOpenChange(details.open)} role="alertdialog" size="sm">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" />
        <Dialog.Positioner p="4">
          <Dialog.Content borderRadius="2xl">
            <Dialog.Header>
              <Stack gap="2">
                <Dialog.Title>Delete this tab?</Dialog.Title>
                <Dialog.Description color="muted">
                  “{tab.name}” will be removed from your saved tabs. Your expenses stay in the main ledger.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {error ? (
                <Alert.Root status="error" borderRadius="xl">
                  <Alert.Indicator />
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer gap="3">
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" borderRadius="xl" disabled={pending}>Keep tab</Button>
              </Dialog.ActionTrigger>
              <Button colorPalette="red" borderRadius="xl" loading={pending} onClick={onDelete}>
                Delete tab
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" borderRadius="lg" aria-label="Close dialog">
                <X size={17} aria-hidden="true" />
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
