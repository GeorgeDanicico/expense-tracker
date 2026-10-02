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
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import {
  DataError,
  DataLoading,
  DataRefresh,
} from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { DailySpendingChart } from "@/components/dashboard/daily-spending-chart";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { ACCOUNT_API_KEY, expensesApiKey } from "@/lib/api/keys";
import { dashboardHref } from "@/lib/frontend/dashboard-state";
import {
  categoryComparisons,
  monthAnalytics,
} from "@/lib/frontend/expense-analytics";
import type { AccountData, ExpensesData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import {
  formatDate,
  formatMonth,
  getCurrentMonth,
  shiftMonth,
} from "@/lib/utils/dates";

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
    <Stack gap="5">
      <MonthToolbar
        month={month}
        href={(value) =>
          dashboardHref(params, { view: "monthly", month: value })
        }
      />
      <Flex gap="2" wrap="wrap">
        <AddExpenseDialog selectedMonth={month} currency={currency} />
        <Button asChild variant="outline">
          <Link href={`/expenses?month=${month}`}>View expenses</Link>
        </Button>
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
          <MetricStrip
            items={[
              {
                label: "Total",
                value: formatCurrency(analytics.total, currency),
              },
              { label: "Transactions", value: String(analytics.count) },
              {
                label: "Average expense",
                value: formatCurrency(analytics.average, currency),
              },
              {
                label: "Largest expense",
                value: formatCurrency(analytics.largest, currency),
              },
            ]}
          />
          {analytics.count === 0 ? (
            <Text color="muted">No recorded expenses</Text>
          ) : null}
          <Surface p="4">
            <Stack gap="3">
              <Heading as="h2">Daily spending</Heading>
              <DailySpendingChart days={analytics.daily} currency={currency} />
            </Stack>
          </Surface>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
            <Surface p="4">
              <Stack gap="3">
                <Heading as="h2">Categories</Heading>
                <CategoryBreakdown
                  items={analytics.categories}
                  currency={currency}
                />
                {analytics.count ? (
                  <Text fontSize="xs" color="muted">
                    Top three categories: {analytics.concentration.toFixed(1)}%
                    of recorded spending.
                  </Text>
                ) : null}
              </Stack>
            </Surface>
            <Surface p="4">
              <Stack gap="3">
                <Heading as="h2">Largest recorded expenses</Heading>
                {analytics.ranked.length ? (
                  <Stack as="ol" pl="4" gap="3">
                    {analytics.ranked.map((expense, index) => (
                      <Stack as="li" key={expense.id} gap="1">
                        <Flex justify="space-between" gap="2" wrap="wrap">
                          <Text fontSize="sm">
                            {index + 1}. {expense.description}
                          </Text>
                          <Text fontWeight="500" overflowWrap="anywhere">
                            {formatCurrency(expense.amount, currency)}
                          </Text>
                        </Flex>
                        <Text color="muted" fontSize="xs">
                          {formatDate(expense.expenseDate)}
                        </Text>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Text color="muted">No recorded expenses</Text>
                )}
              </Stack>
            </Surface>
          </SimpleGrid>
          <Surface p="4">
            <Stack gap="3">
              <Heading as="h2">
                Compared with {formatMonth(previousMonth)}
              </Heading>
              {!completed ? (
                <Text color="muted" fontSize="sm">
                  Comparison available after this month ends.
                </Text>
              ) : !before ? (
                previous.error ? (
                  <DataError retry={() => void previous.mutate()} />
                ) : (
                  <DataLoading label="Loading comparison…" />
                )
              ) : (
                <>
                  <DataRefresh
                    error={previous.error}
                    updating={previous.isValidating}
                    retry={() => void previous.mutate()}
                  />
                  <AmountComparison
                    current={analytics.total}
                    previous={before.total}
                    currency={currency}
                  />
                  <Stack as="ul" listStyleType="none" gap="3">
                    {categoryComparisons(
                      analytics.categories,
                      before.categories,
                    ).map((item) => (
                      <Flex
                        as="li"
                        key={item.category}
                        gap="2"
                        justify="space-between"
                        wrap="wrap"
                      >
                        <Text fontSize="sm">{item.label}</Text>
                        <AmountComparison
                          current={
                            analytics.categories.find(
                              (c) => c.category === item.category,
                            )?.total ?? 0
                          }
                          previous={
                            before.categories.find(
                              (c) => c.category === item.category,
                            )?.total ?? 0
                          }
                          currency={currency}
                        />
                      </Flex>
                    ))}
                  </Stack>
                </>
              )}
            </Stack>
          </Surface>
        </>
      )}
    </Stack>
  );
}
