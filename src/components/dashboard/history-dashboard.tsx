"use client";

import { Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import useSWR from "swr";
import {
  DataError,
  DataLoading,
  DataRefresh,
} from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { StatsFilter } from "@/components/dashboard/stats-filter";
import { ACCOUNT_API_KEY, dashboardApiKey } from "@/lib/api/keys";
import {
  historyBoundaries,
  seriesInsights,
} from "@/lib/frontend/expense-analytics";
import type { AccountData, AnalyticsFilters, DashboardData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatMonth } from "@/lib/utils/dates";

export function HistoryDashboard({ filters }: { filters: AnalyticsFilters }) {
  const { data, error, isValidating, mutate } = useSWR<DashboardData>(
    dashboardApiKey(filters),
    { keepPreviousData: false },
  );
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;
  const boundaries = historyBoundaries(filters, data?.currentMonth);
  const single = filters.period === "custom";
  const day = single && filters.granularity === "day";
  const insights = seriesInsights(data?.analytics.series ?? []);
  return (
    <Stack gap="5">
      <StatsFilter
        key={`${filters.period}-${filters.granularity}-${filters.customDate}`}
        initialPeriod={filters.period}
        initialGranularity={filters.granularity}
        initialCustomDate={filters.customDate}
      />
      <Text fontSize="xs" color="muted">
        {day
          ? formatDate(boundaries.start)
          : `${formatDate(boundaries.start)} – ${formatDate(boundaries.end)}`}
        {single ? "" : " · Completed months"}
      </Text>
      {!data ? (
        error ? (
          <DataError retry={() => void mutate()} />
        ) : (
          <DataLoading label="Loading history…" />
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
                value: formatCurrency(data.analytics.total, currency),
              },
              { label: "Transactions", value: String(data.analytics.count) },
              {
                label: day ? "Average expense" : "Monthly average",
                value: formatCurrency(
                  day
                    ? data.analytics.count
                      ? data.analytics.total / data.analytics.count
                      : 0
                    : insights.average,
                  currency,
                ),
              },
            ]}
          />
          {data.analytics.count === 0 ? (
            <Text color="muted">No recorded expenses</Text>
          ) : null}
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
            <Surface p="4">
              <Stack gap="3">
                <Heading as="h2">
                  {day ? "Recorded spending" : "Monthly trend"}
                </Heading>
                <MonthlyBarChart
                  series={data.analytics.series}
                  currency={currency}
                />
              </Stack>
            </Surface>
            <Surface p="4">
              <Stack gap="3">
                <Heading as="h2">Categories</Heading>
                <CategoryBreakdown
                  items={data.analytics.categoryTotals}
                  currency={currency}
                />
              </Stack>
            </Surface>
          </SimpleGrid>
          {!single && data.analytics.series.length > 1 ? (
            <>
              <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4">
                {[
                  { label: "Highest spending", items: insights.highest },
                  { label: "Lowest spending", items: insights.lowest },
                ].map((group) => (
                  <Surface key={group.label} p="4">
                    <Stack gap="2">
                      <Heading as="h2">{group.label}</Heading>
                      {group.items.map((item) => (
                        <Text
                          key={item.key}
                          fontSize="sm"
                          overflowWrap="anywhere"
                        >
                          {formatMonth(item.key)} ·{" "}
                          {formatCurrency(item.total, currency)}
                        </Text>
                      ))}
                    </Stack>
                  </Surface>
                ))}
              </SimpleGrid>
              <Surface p="4">
                <Stack gap="3">
                  <Heading as="h2">Month to month</Heading>
                  {insights.changes.map((change, i) => (
                    <Stack key={change.key} gap="1">
                      <Text color="muted" fontSize="xs">
                        {formatMonth(change.key)} compared with{" "}
                        {formatMonth(change.previousKey)}
                      </Text>
                      <AmountComparison
                        current={data.analytics.series[i + 1].total}
                        previous={data.analytics.series[i].total}
                        currency={currency}
                      />
                    </Stack>
                  ))}
                </Stack>
              </Surface>
            </>
          ) : null}
        </>
      )}
    </Stack>
  );
}
