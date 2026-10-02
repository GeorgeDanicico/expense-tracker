"use client";

import { Box, Button, Flex, Heading, Stack } from "@chakra-ui/react";
import { Download } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, Suspense } from "react";
import useSWR from "swr";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { ExpenseList } from "@/components/expenses/expense-list";
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import {
  DataError,
  DataLoading,
  DataRefresh,
} from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ACCOUNT_API_KEY, expensesApiKey } from "@/lib/api/keys";
import type { AccountData, ExpensesData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import { getCurrentMonth, isValidMonth } from "@/lib/utils/dates";

function ExpensesContent() {
  useDocumentTitle("Expenses");
  const searchParams = useSearchParams();
  const requested = searchParams.get("month");
  const month =
    requested && isValidMonth(requested) ? requested : getCurrentMonth();
  const { data, error, isValidating, mutate } = useSWR<ExpensesData>(
    expensesApiKey(month),
    { keepPreviousData: false },
  );
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;
  const matching = data?.month === month ? data : undefined;
  return (
    <Stack gap="5">
      <PageHeader title="Expenses">
        <Flex gap="2" wrap="wrap">
          <AddExpenseDialog selectedMonth={month} currency={currency} />
          <Button asChild variant="outline">
            <Link href={`/api/expenses/export?month=${month}`}>
              <Download size={17} aria-hidden="true" /> Export
            </Link>
          </Button>
        </Flex>
      </PageHeader>
      <MonthToolbar
        month={month}
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
              {
                label: "Total",
                value: formatCurrency(matching.total, currency),
              },
              {
                label: "Transactions",
                value: String(matching.expenses.length),
              },
              {
                label: "Average expense",
                value: formatCurrency(matching.average, currency),
              },
            ]}
          />
        </>
      )}
      <Activity mode={matching ? "visible" : "hidden"}>
        <Surface overflow="hidden">
          <Box p="4" pb="0">
            <Heading as="h2">All expenses</Heading>
          </Box>
          <ExpenseList
            expenses={matching?.expenses ?? []}
            currency={currency}
            allowDelete
          />
        </Surface>
      </Activity>
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
