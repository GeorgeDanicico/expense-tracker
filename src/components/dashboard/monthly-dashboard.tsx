"use client";

import { Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import useSWR from "swr";

import { CardLink } from "@/components/dashboard/card-link";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { DailySpendingChart } from "@/components/dashboard/daily-spending-chart";
import { MonthComparison } from "@/components/dashboard/month-comparison";
import { MonthlyStats } from "@/components/dashboard/monthly-stats";
import { TopExpenses } from "@/components/dashboard/top-expenses";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { ACCOUNT_API_KEY, expensesApiKey } from "@/lib/api/keys";
import { dashboardHref } from "@/lib/frontend/dashboard-state";
import { monthAnalytics } from "@/lib/frontend/expense-analytics";
import type { AccountData, ExpensesData } from "@/lib/types";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";
import { getCurrentMonth, shiftMonth } from "@/lib/utils/dates";

export function MonthlyDashboard({
  month,
  params,
}: {
  month: string;
  params: URLSearchParams;
}) {
  const current = useSWR<ExpensesData>(expensesApiKey(month), {
    keepPreviousData: false,
  });
  const previousMonth = shiftMonth(month, -1);
  const previous = useSWR<ExpensesData>(expensesApiKey(previousMonth), {
    keepPreviousData: false,
  });
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;
  const matching = current.data?.month === month ? current.data : undefined;
  const before =
    previous.data?.month === previousMonth
      ? monthAnalytics(previous.data.expenses, previousMonth)
      : null;
  const completed = month < getCurrentMonth();
  const analytics = matching ? monthAnalytics(matching.expenses, month) : null;
  return (
    <Stack gap="4">
      <MonthToolbar
        month={month}
        href={(value) => dashboardHref(params, { view: "monthly", month: value })}
      />
      <Flex gap="2" wrap="wrap" align="center">
        <AddExpenseDialog selectedMonth={month} currency={currency} />
        <CardLink href={`/expenses?month=${month}`}>View expenses</CardLink>
      </Flex>
      {!analytics ? (
        current.error ? (
          <DataError retry={() => void current.mutate()} />
        ) : (
          <DataLoading label="Loading this month…" />
        )
      ) : (
        <>
          <DataRefresh
            error={current.error}
            updating={current.isValidating}
            retry={() => void current.mutate()}
          />
          <Card>
            <Card.Body>
              <MonthlyStats analytics={analytics} currency={currency} />
            </Card.Body>
          </Card>
          {analytics.count === 0 ? (
            <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>
          ) : null}
          <Card>
            <Card.Header title="Daily spending" />
            <Card.Body>
              <DailySpendingChart days={analytics.daily} currency={currency} />
            </Card.Body>
          </Card>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
            <Card>
              <Card.Header title="Categories" />
              <Card.Body>
                <Stack gap="3">
                  <CategoryBreakdown items={analytics.categories} currency={currency} />
                  {analytics.count ? (
                    <Text textStyle="caption">
                      Top three categories: {analytics.concentration.toFixed(1)}% of recorded spending.
                    </Text>
                  ) : null}
                </Stack>
              </Card.Body>
            </Card>
            <TopExpenses expenses={analytics.ranked} currency={currency} />
          </SimpleGrid>
          <MonthComparison
            previousMonth={previousMonth}
            completed={completed}
            current={analytics}
            before={before}
            currency={currency}
            previousError={previous.error}
            previousValidating={previous.isValidating}
            retryPrevious={() => void previous.mutate()}
          />
        </>
      )}
    </Stack>
  );
}
