"use client";

import { useMemo } from "react";
import { SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { Stat, StatGroup } from "@/components/ui/stat";
import { expenseTabAnalytics } from "@/lib/frontend/expense-analytics";
import type { ExpenseTabLedgerData } from "@/lib/expenses/tabs";
import { normalizeCurrency } from "@/lib/utils/currency";

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
    <Stack gap="4">
      <StatGroup>
        <Stat size="hero" label="Total" value={<Amount value={analytics.total} currency={displayCurrency} size="hero" />} />
        <Stat size="sm" label="Transactions" value={String(analytics.count)} />
        <Stat size="sm" label="Average expense" value={<Amount value={analytics.average} currency={displayCurrency} />} />
      </StatGroup>

      {analytics.count === 0 ? (
        <Text textStyle="bodySm" color="fg.muted">
          No expenses match the current tab filters. Change the date, category,
          subtype, or search filters to see matching spending.
        </Text>
      ) : null}

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="3">
        <Card variant="subtle" size="sm">
          <Card.Header title="Spending over time" />
          <Card.Body>
            <MonthlyBarChart
              series={analytics.series}
              currency={displayCurrency}
              ariaLabel={`Spending by calendar ${period}`}
              getHref={() => null}
            />
          </Card.Body>
        </Card>
        <Card variant="subtle" size="sm">
          <Card.Header title="Spending by category and subtype" />
          <Card.Body>
            <CategoryBreakdown
              items={analytics.breakdown}
              currency={displayCurrency}
              ariaLabel="Spending by category and subtype"
            />
          </Card.Body>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
