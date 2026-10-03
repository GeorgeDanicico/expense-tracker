"use client";

import { useMemo } from "react";
import { Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { Surface } from "@/components/ui/surface";
import { expenseTabAnalytics } from "@/lib/frontend/expense-analytics";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { formatCurrency, normalizeCurrency } from "@/lib/utils/currency";

export function ExpenseTabDashboard({
  ledger,
  currency,
}: {
  ledger: ExpenseTabLedgerData;
  currency: string;
}) {
  const analytics = useMemo(
    () => expenseTabAnalytics(ledger.expenses, ledger.filters),
    [ledger.expenses, ledger.filters],
  );
  const displayCurrency = normalizeCurrency(currency);
  const period = analytics.series[0]?.key.length === 4 ? "year" : "month";

  return (
    <Stack gap="5">
      <MetricStrip
        items={[
          { label: "Total", value: formatCurrency(analytics.total, displayCurrency) },
          { label: "Transactions", value: String(analytics.count) },
          {
            label: "Average expense",
            value: formatCurrency(analytics.average, displayCurrency),
          },
        ]}
      />

      {analytics.count === 0 ? (
        <Text color="muted">
          No expenses match the current tab filters. Change the date, category,
          subtype, or search filters to see matching spending.
        </Text>
      ) : null}

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
        <Surface p="4">
          <Stack gap="3">
            <Heading as="h2">Spending over time</Heading>
            <MonthlyBarChart
              series={analytics.series}
              currency={displayCurrency}
              ariaLabel={`Spending by calendar ${period}`}
              getHref={() => null}
            />
          </Stack>
        </Surface>
        <Surface p="4">
          <Stack gap="3">
            <Heading as="h2">Spending by category and subtype</Heading>
            <CategoryBreakdown
              items={analytics.breakdown}
              currency={displayCurrency}
              ariaLabel="Spending by category and subtype"
            />
          </Stack>
        </Surface>
      </SimpleGrid>
    </Stack>
  );
}
