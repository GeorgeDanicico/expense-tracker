"use client";

import {
  Button,
  Flex,
  Heading,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import Link from "next/link";
import useSWR from "swr";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { ExpenseList } from "@/components/expenses/expense-list";
import {
  DataError,
  DataLoading,
  DataRefresh,
} from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { ACCOUNT_API_KEY, dashboardApiKey } from "@/lib/api/keys";
import { categoryShares } from "@/lib/frontend/expense-analytics";
import { dashboardHref } from "@/lib/frontend/dashboard-state";
import type { AccountData, DashboardData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import { formatMonth, getCurrentMonth } from "@/lib/utils/dates";

export function SummaryDashboard({ params }: { params: URLSearchParams }) {
  const { data, error, isValidating, mutate } = useSWR<DashboardData>(
    dashboardApiKey({
      period: "3m",
      granularity: "month",
      customDate: getCurrentMonth(),
    }),
    { keepPreviousData: false },
  );
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;
  if (!data)
    return error ? (
      <DataError retry={() => void mutate()} />
    ) : (
      <DataLoading label="Loading summary…" />
    );
  const series = data.analytics.series.slice(-3);
  const latest = series.at(-1),
    previous = series.at(-2);
  const leader = categoryShares(data.analytics.categoryTotals)[0];
  return (
    <Stack gap="5">
      <DataRefresh
        error={error}
        updating={isValidating}
        retry={() => void mutate()}
      />
      <Flex align="center" justify="space-between" gap="3" wrap="wrap">
        <Heading as="h2">{formatMonth(data.currentMonth)}</Heading>
        <AddExpenseDialog
          selectedMonth={data.currentMonth}
          currency={currency}
        />
      </Flex>
      <MetricStrip
        items={[
          {
            label: "Total",
            value: formatCurrency(data.currentTotal, currency),
          },
          { label: "Transactions", value: String(data.currentCount) },
          {
            label: "Average expense",
            value: formatCurrency(data.currentAverage, currency),
          },
          {
            label: "Largest expense",
            value: formatCurrency(data.currentLargest, currency),
          },
        ]}
      />
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
        <Surface p="4">
          <Stack gap="3">
            <Heading as="h2">Previous three completed months</Heading>
            <MonthlyBarChart series={series} currency={currency} />
            {latest && previous ? (
              <Stack gap="1">
                <Text color="muted" fontSize="xs">
                  {formatMonth(latest.key)} compared with{" "}
                  {formatMonth(previous.key)}
                </Text>
                <AmountComparison
                  current={latest.total}
                  previous={previous.total}
                  currency={currency}
                />
              </Stack>
            ) : null}
          </Stack>
        </Surface>
        <Surface p="4">
          <Stack gap="3">
            <Heading as="h2">Leading category</Heading>
            {leader ? (
              <>
                <Text fontWeight="500">{leader.label}</Text>
                <Text
                  fontSize="1.5rem"
                  fontWeight="600"
                  overflowWrap="anywhere"
                >
                  {formatCurrency(leader.total, currency)}
                </Text>
                <Text color="muted" fontSize="xs">
                  {leader.share.toFixed(1)}% of recorded spending over the
                  previous three completed months.
                </Text>
              </>
            ) : (
              <Text color="muted">No recorded expenses</Text>
            )}
          </Stack>
        </Surface>
      </SimpleGrid>
      <Surface overflow="hidden">
        <Heading as="h2" p="4" pb="1">
          Recent expenses
        </Heading>
        <ExpenseList
          expenses={data.currentExpenses}
          currency={currency}
          compact
        />
      </Surface>
      <Flex gap="2" wrap="wrap">
        <Button asChild variant="outline">
          <Link href={`/expenses?month=${data.currentMonth}`}>
            View expenses
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link
            href={dashboardHref(params, {
              view: "monthly",
              month: data.currentMonth,
            })}
          >
            Explore this month
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={dashboardHref(params, { view: "history" })}>
            View history
          </Link>
        </Button>
      </Flex>
    </Stack>
  );
}
