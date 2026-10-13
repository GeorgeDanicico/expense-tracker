"use client";

import { Box, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import useSWR from "swr";

import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { CardLink } from "@/components/dashboard/card-link";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { ExpenseList } from "@/components/expenses/expense-list";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Stat, StatGroup } from "@/components/ui/stat";
import { ACCOUNT_API_KEY, dashboardApiKey } from "@/lib/api/keys";
import { dashboardHref } from "@/lib/frontend/dashboard-state";
import { categoryShares } from "@/lib/frontend/expense-analytics";
import type { AccountData, DashboardData } from "@/lib/types";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";
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
    <Stack gap="4">
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
      <Card>
        <Card.Header
          title={formatMonth(data.currentMonth)}
          actions={
            <CardLink href={dashboardHref(params, { view: "monthly", month: data.currentMonth })}>
              Explore month
            </CardLink>
          }
        />
        <Card.Body>
          <Stack gap="4">
            <StatGroup>
              <Stat size="hero" label="Total" value={<Amount value={data.currentTotal} currency={currency} size="hero" />} />
              <Stat size="sm" label="Transactions" value={String(data.currentCount)} />
              <Stat size="sm" label="Average expense" value={<Amount value={data.currentAverage} currency={currency} />} />
              <Stat size="sm" label="Largest expense" value={<Amount value={data.currentLargest} currency={currency} />} />
            </StatGroup>
            <Box>
              <AddExpenseDialog selectedMonth={data.currentMonth} currency={currency} />
            </Box>
          </Stack>
        </Card.Body>
      </Card>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
        <Card>
          <Card.Header
            title="Previous three completed months"
            actions={<CardLink href={dashboardHref(params, { view: "history" })}>View history</CardLink>}
          />
          <Card.Body>
            <Stack gap="3">
              <MonthlyBarChart series={series} currency={currency} />
              {latest && previous ? (
                <Stack gap="0.5">
                  <Text textStyle="caption">
                    {formatMonth(latest.key)} compared with {formatMonth(previous.key)}
                  </Text>
                  <AmountComparison current={latest.total} previous={previous.total} currency={currency} />
                </Stack>
              ) : null}
            </Stack>
          </Card.Body>
        </Card>
        <Card>
          <Card.Header title="Leading category" />
          <Card.Body>
            {leader ? (
              <Stack gap="1">
                <Text textStyle="bodySm" fontWeight="medium">{leader.label}</Text>
                <Amount value={leader.total} currency={currency} size="lg" as="p" />
                <Text textStyle="caption">
                  {leader.share.toFixed(1)}% of recorded spending over the previous three completed months.
                </Text>
              </Stack>
            ) : (
              <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>
            )}
          </Card.Body>
        </Card>
      </SimpleGrid>
      <Card overflow="hidden">
        <Card.Header
          title="Recent expenses"
          actions={<CardLink href={`/expenses?month=${data.currentMonth}`}>View all</CardLink>}
        />
        <Box mt="3" borderTopWidth="1px" borderColor="border">
          <ExpenseList expenses={data.currentExpenses} currency={currency} compact />
        </Box>
      </Card>
    </Stack>
  );
}
