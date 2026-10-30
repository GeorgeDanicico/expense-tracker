"use client";

import {
  Box,
  Button,
  Stack,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { Download } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Suspense } from "react";
import useSWR from "swr";

import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { CustomExpenseTab } from "@/components/expenses/custom-expense-tab";
import { FamilyExpensesPanel } from "@/components/expenses/family-expenses-panel";
import { ViewingControls } from "@/components/family/viewing-picker";
import { WriteOnly } from "@/components/family/write-only";
import { ExpenseTabDialog } from "@/components/expenses/expense-tab-dialog";
import { ExpenseTabs, MAIN_EXPENSE_TAB } from "@/components/expenses/expense-tabs";
import { ImportStatementButton } from "@/components/expenses/import-statement-button";
import { MainExpensesPanel } from "@/components/expenses/main-expenses-panel";
import { PermissionGate } from "@/components/layout/permission-gate";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useExpenseTabRouting } from "@/hooks/use-expense-tab-routing";
import { useViewing } from "@/hooks/use-viewing";
import {
  expenseTabsApiKey,
  mainExpensesExportUrl,
  type TabsResponse,
} from "@/lib/api/keys";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import { resolveMainExpenseMonth } from "@/lib/calendar";

type DialogTarget = { mode: "create" } | { mode: "edit"; tab: ExpenseTab };

function ExpensesContent() {
  useDocumentTitle("Expenses");
  const searchParams = useSearchParams();
  const requestedMonth = searchParams.get("month");
  const month = resolveMainExpenseMonth(requestedMonth);
  const viewing = useViewing();
  const {
    data: tabsResult,
    error: tabsError,
    isValidating: tabsUpdating,
    mutate: mutateTabs,
  } = useSWR<TabsResponse>(
    // Saved tabs belong to one person, so the family view has none.
    viewing.family ? null : expenseTabsApiKey(viewing.member),
  );
  const tabs = tabsResult?.tabs ?? [];
  const { currency } = viewing;
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  const { activeTabId, activeTab, changeTab, saveTab, returnToMain } = useExpenseTabRouting(tabsResult);

  function openSavedTab(tab: ExpenseTab) {
    const target = dialogTarget;
    setDialogTarget(null);
    saveTab(tab, { keepFilters: target?.mode === "edit" });
  }

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader
        title="Expenses"
        actions={activeTabId === null ? (
          <>
            <WriteOnly>
              <AddExpenseDialog selectedMonth={month} currency={currency} />
              <ImportStatementButton />
            </WriteOnly>
            {viewing.family ? null : (
              <Button asChild variant="ghost" size={{ base: "md", sm: "sm" }}>
                <Link href={mainExpensesExportUrl(month, viewing.member)}>
                  <Download size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Export
                </Link>
              </Button>
            )}
          </>
        ) : undefined}
      />

      <ViewingControls noun="expenses" family />

      {tabsError ? (
        <DataRefresh error={tabsError} updating={tabsUpdating} retry={() => void mutateTabs()} />
      ) : tabsUpdating ? (
        <DataRefresh updating={tabsUpdating} retry={() => void mutateTabs()} />
      ) : null}

      <ExpenseTabs
        tabs={tabs}
        value={activeTab}
        onValueChange={changeTab}
        onCreate={viewing.readOnly ? undefined : () => setDialogTarget({ mode: "create" })}
      >
        <Tabs.Content value={MAIN_EXPENSE_TAB} p="0">
          {viewing.ready && viewing.family ? (
            <FamilyExpensesPanel month={month} currency={currency} />
          ) : viewing.ready ? (
            <MainExpensesPanel month={month} currency={currency} />
          ) : <DataLoading label="Loading expenses…" />}
        </Tabs.Content>
        {tabs.map((tab) => (
          <Tabs.Content key={tab.id} value={tab.id} p="0">
            <CustomExpenseTab
              tab={tab}
              active={tab.id === activeTabId && viewing.ready}
              currency={currency}
              onEdit={(selected) => setDialogTarget({ mode: "edit", tab: selected })}
              onDeleted={returnToMain}
            />
          </Tabs.Content>
        ))}
        {activeTabId && !tabsResult ? (
          <Box py="8">
            {tabsError ? (
              <DataError message="Saved expense tabs could not be loaded." retry={() => void mutateTabs()} />
            ) : <DataLoading label="Loading saved tabs…" />}
          </Box>
        ) : null}
        {activeTabId && tabsResult && !tabs.some((tab) => tab.id === activeTabId) ? (
          <Box py="8" role="status">
            <Text textStyle="bodySm" color="fg.muted">This tab is no longer available. Returning to Expenses…</Text>
          </Box>
        ) : null}
      </ExpenseTabs>

      {dialogTarget ? (
        <ExpenseTabDialog
          key={dialogTarget.mode === "edit" ? dialogTarget.tab.id : "new"}
          open
          onOpenChange={(open) => { if (!open) setDialogTarget(null); }}
          tab={dialogTarget.mode === "edit" ? dialogTarget.tab : undefined}
          onSaved={openSavedTab}
        />
      ) : null}
    </Stack>
  );
}

export default function ExpensesPage() {
  return (
    <PermissionGate module="expenses">
      <Suspense fallback={<DataLoading label="Loading expenses…" />}>
        <ExpensesContent />
      </Suspense>
    </PermissionGate>
  );
}
