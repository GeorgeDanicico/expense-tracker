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
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Suspense } from "react";
import useSWR from "swr";

import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { CustomExpenseTab } from "@/components/expenses/custom-expense-tab";
import { ExpenseTabDialog } from "@/components/expenses/expense-tab-dialog";
import { ExpenseTabs, MAIN_EXPENSE_TAB } from "@/components/expenses/expense-tabs";
import { MainExpensesPanel } from "@/components/expenses/main-expenses-panel";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  ACCOUNT_API_KEY,
  EXPENSE_TABS_API_KEY,
  mainExpensesExportUrl,
} from "@/lib/api/keys";
import { expenseTabHref, readExpenseTabFilters } from "@/lib/frontend/expense-tab-state";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { AccountData } from "@/lib/types";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";
import { resolveMainExpenseMonth } from "@/lib/calendar";

type TabsResponse = { tabs: ExpenseTab[] };
type DialogTarget = { mode: "create" } | { mode: "edit"; tab: ExpenseTab };

function ExpensesContent() {
  useDocumentTitle("Expenses");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const params = new URLSearchParams(queryString);
  const activeTabId = searchParams.get("tab") || null;
  const activeTab = activeTabId ?? MAIN_EXPENSE_TAB;
  const requestedMonth = searchParams.get("month");
  const month = resolveMainExpenseMonth(requestedMonth);
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const {
    data: tabsResult,
    error: tabsError,
    isValidating: tabsUpdating,
    mutate: mutateTabs,
  } = useSWR<TabsResponse>(EXPENSE_TABS_API_KEY);
  const tabs = tabsResult?.tabs ?? [];
  const currency = account?.currency ?? DEFAULT_CURRENCY;
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null);

  useEffect(() => {
    if (!activeTabId || !tabsResult) return;
    if (tabsResult.tabs.some((tab) => tab.id === activeTabId)) return;
    router.replace(expenseTabHref(new URLSearchParams(queryString), null), { scroll: false });
  }, [activeTabId, queryString, router, tabsResult]);

  function changeTab(value: string) {
    const tabId = value === MAIN_EXPENSE_TAB ? null : value;
    router.push(expenseTabHref(new URLSearchParams(queryString), tabId), { scroll: false });
  }

  function saveTab(tab: ExpenseTab) {
    const target = dialogTarget;
    setDialogTarget(null);
    const filters = target?.mode === "edit" ? readExpenseTabFilters(params) : undefined;
    router.push(expenseTabHref(new URLSearchParams(queryString), tab.id, filters), { scroll: false });
  }

  function returnToMain() {
    router.push(expenseTabHref(new URLSearchParams(queryString), null), { scroll: false });
  }

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader
        title="Expenses"
        actions={activeTabId === null ? (
          <>
            <AddExpenseDialog selectedMonth={month} currency={currency} />
            <Button asChild variant="ghost" size={{ base: "md", sm: "sm" }}>
              <Link href={mainExpensesExportUrl(month)}>
                <Download size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Export
              </Link>
            </Button>
          </>
        ) : undefined}
      />

      {tabsError ? (
        <DataRefresh error={tabsError} updating={tabsUpdating} retry={() => void mutateTabs()} />
      ) : tabsUpdating ? (
        <DataRefresh updating={tabsUpdating} retry={() => void mutateTabs()} />
      ) : null}

      <ExpenseTabs
        tabs={tabs}
        value={activeTab}
        onValueChange={changeTab}
        onCreate={() => setDialogTarget({ mode: "create" })}
      >
        <Tabs.Content value={MAIN_EXPENSE_TAB} p="0">
          <MainExpensesPanel month={month} currency={currency} />
        </Tabs.Content>
        {tabs.map((tab) => (
          <Tabs.Content key={tab.id} value={tab.id} p="0">
            <CustomExpenseTab
              tab={tab}
              active={tab.id === activeTabId}
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
          onSaved={saveTab}
        />
      ) : null}
    </Stack>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<DataLoading label="Loading expenses…" />}>
      <ExpensesContent />
    </Suspense>
  );
}
