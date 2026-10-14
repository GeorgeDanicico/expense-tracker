"use client";

import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import useSWR from "swr";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { HistoryInsights } from "@/components/dashboard/history-insights";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { StatsFilter } from "@/components/dashboard/stats-filter";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Stat, StatGroup } from "@/components/ui/stat";
import { ACCOUNT_API_KEY, dashboardApiKey } from "@/lib/api/keys";
import { historyBoundaries, seriesInsights } from "@/lib/expenses/analytics";
import type { AccountData } from "@/lib/account";
import type { AnalyticsFilters, DashboardData } from "@/lib/expenses/types";
import { DEFAULT_CURRENCY } from "@/lib/utils/currency";
import { formatDate } from "@/lib/calendar";

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
    <Stack gap="4">
      <Stack gap="1.5">
        <StatsFilter
          key={`${filters.period}-${filters.granularity}-${filters.customDate}`}
          initialPeriod={filters.period}
          initialGranularity={filters.granularity}
          initialCustomDate={filters.customDate}
        />
        <Text textStyle="caption">
          {day
            ? formatDate(boundaries.start)
            : `${formatDate(boundaries.start)} – ${formatDate(boundaries.end)}`}
          {single ? "" : " · Completed months"}
        </Text>
      </Stack>
      {!data ? (
        error ? (
          <DataError retry={() => void mutate()} />
        ) : (
          <DataLoading label="Loading history…" />
        )
      ) : (
        <>
          <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
          <Card>
            <Card.Body>
              <StatGroup>
                <Stat size="hero" label="Total" value={<Amount value={data.analytics.total} currency={currency} size="hero" />} />
                <Stat size="sm" label="Transactions" value={String(data.analytics.count)} />
                <Stat
                  size="sm"
                  label={day ? "Average expense" : "Monthly average"}
                  value={
                    <Amount
                      value={day ? (data.analytics.count ? data.analytics.total / data.analytics.count : 0) : insights.average}
                      currency={currency}
                    />
                  }
                />
              </StatGroup>
            </Card.Body>
          </Card>
          {data.analytics.count === 0 ? (
            <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>
          ) : null}
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
            <Card>
              <Card.Header title={day ? "Recorded spending" : "Monthly trend"} />
              <Card.Body>
                <MonthlyBarChart series={data.analytics.series} currency={currency} />
              </Card.Body>
            </Card>
            <Card>
              <Card.Header title="Categories" />
              <Card.Body>
                <CategoryBreakdown items={data.analytics.categoryTotals} currency={currency} />
              </Card.Body>
            </Card>
          </SimpleGrid>
          {!single && data.analytics.series.length > 1 ? (
            <HistoryInsights insights={insights} series={data.analytics.series} currency={currency} />
          ) : null}
        </>
      )}
    </Stack>
  );
}
