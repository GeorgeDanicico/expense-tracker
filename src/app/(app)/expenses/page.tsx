"use client";

import {
  Box,
  Button,
  Flex,
  Heading,
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

import { MetricStrip } from "@/components/dashboard/metric-strip";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { CustomExpenseTab } from "@/components/expenses/custom-expense-tab";
import { ExpenseList } from "@/components/expenses/expense-list";
import { ExpenseTabDialog } from "@/components/expenses/expense-tab-dialog";
import { ExpenseTabs, MAIN_EXPENSE_TAB } from "@/components/expenses/expense-tabs";
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import {
  DataError,
  DataLoading,
  DataRefresh,
} from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  ACCOUNT_API_KEY,
  EXPENSE_TABS_API_KEY,
  mainExpensesApiKey,
  mainExpensesExportUrl,
} from "@/lib/api/keys";
import { expenseTabHref, readExpenseTabFilters } from "@/lib/frontend/expense-tab-state";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import type { AccountData, ExpensesData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import { getApplicationCurrentMonth, resolveMainExpenseMonth } from "@/lib/utils/dates";

type TabsResponse = { tabs: ExpenseTab[] };
type DialogTarget = { mode: "create" } | { mode: "edit"; tab: ExpenseTab };

function MainExpensesPanel({ month, currency }: { month: string; currency: string }) {
  const { data, error, isValidating, mutate } = useSWR<ExpensesData>(
    mainExpensesApiKey(month),
    { keepPreviousData: false },
  );
  const matching = data?.month === month ? data : undefined;

  return (
    <Stack gap="5">
      <MonthToolbar
        month={month}
        maxMonth={getApplicationCurrentMonth()}
        href={(value) => `/expenses?month=${value}`}
      />
      {!matching ? (
        error ? (
          <DataError retry={() => void mutate()} />
        ) : (
          <DataLoading label="Loading expenses…" />
        )
      ) : (
        <>
          <DataRefresh
            error={error}
            updating={isValidating}
            retry={() => void mutate()}
          />
          <MetricStrip
            items={[
              { label: "Total", value: formatCurrency(matching.total, currency) },
              { label: "Transactions", value: String(matching.expenses.length) },
              { label: "Average expense", value: formatCurrency(matching.average, currency) },
            ]}
          />
          <Surface overflow="hidden">
            <Box p="4" pb="0">
              <Heading as="h2">All expenses</Heading>
            </Box>
            <ExpenseList expenses={matching.expenses} currency={currency} allowDelete />
          </Surface>
        </>
      )}
    </Stack>
  );
}

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
    <Stack gap="5">
      <PageHeader title="Expenses">
        {activeTabId === null ? (
          <Flex gap="2" wrap="wrap">
            <AddExpenseDialog selectedMonth={month} currency={currency} />
            <Button asChild variant="outline">
              <Link href={mainExpensesExportUrl(month)}>
                <Download size={17} aria-hidden="true" /> Export
              </Link>
            </Button>
          </Flex>
        ) : null}
      </PageHeader>

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
            <Text color="muted">This tab is no longer available. Returning to Expenses…</Text>
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
