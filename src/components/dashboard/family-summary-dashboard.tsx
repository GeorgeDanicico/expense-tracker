"use client";

import { Box, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import useSWR from "swr";

import { CurrencyAmounts } from "@/components/expenses/currency-totals";
import { ExpenseList } from "@/components/expenses/expense-list";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { CardLink } from "@/components/ui/card-link";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Stat, StatGroup } from "@/components/ui/stat";
import { useViewing } from "@/hooks/use-viewing";
import { dashboardApiKey } from "@/lib/api/keys";
import { formatMonth, getBucharestMonth } from "@/lib/calendar";
import type { FamilyDashboardData } from "@/lib/expenses/types";

/** The family view of the summary: this month and the last three, combined per currency, and who spent it. */
export function FamilySummaryDashboard() {
  const { member, currency, hrefFor } = useViewing();
  const { data, error, isValidating, mutate } = useSWR<FamilyDashboardData>(
    dashboardApiKey({ period: "3m", granularity: "month", customDate: getBucharestMonth() }, member),
    { keepPreviousData: false },
  );
  if (!data)
    return error ? <DataError retry={() => void mutate()} /> : <DataLoading label="Loading summary…" />;

  return (
    <Stack gap="4">
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
      <Card>
        <Card.Header title={`${formatMonth(data.currentMonth)}, whole family`} />
        <Card.Body>
          <StatGroup>
            <Stat
              size="hero"
              label="Total"
              value={<CurrencyAmounts totals={data.totals} fallbackCurrency={currency} size="hero" />}
            />
            <Stat size="sm" label="Transactions" value={String(data.members.reduce((sum, row) => sum + row.count, 0))} />
            <Stat
              size="sm"
              label="Average expense"
              value={<CurrencyAmounts totals={data.totals} field="average" fallbackCurrency={currency} />}
            />
            <Stat
              size="sm"
              label="Largest expense"
              value={<CurrencyAmounts totals={data.totals} field="largest" fallbackCurrency={currency} />}
            />
          </StatGroup>
        </Card.Body>
      </Card>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
        <Card>
          <Card.Header title="By member" />
          <Card.Body>
            <Stack as="ul" gap="2" m="0" p="0" listStyleType="none">
              {data.members.map((row) => (
                <Flex as="li" key={row.memberId} justify="space-between" align="baseline" gap="3">
                  <Stack gap="0" minW="0">
                    <Text textStyle="bodySm" fontWeight="medium" truncate>
                      {row.name}
                    </Text>
                    <Text textStyle="caption">{row.count === 1 ? "1 transaction" : `${row.count} transactions`}</Text>
                  </Stack>
                  <Amount value={row.total} currency={row.currency} size="sm" />
                </Flex>
              ))}
            </Stack>
          </Card.Body>
        </Card>
        <Card>
          <Card.Header title={data.analyticsLabel || "Previous three completed months"} />
          <Card.Body>
            <Stack gap="1">
              <CurrencyAmounts
                totals={data.analyticsTotals.map((entry) => ({ ...entry, average: 0, largest: 0 }))}
                fallbackCurrency={currency}
                size="lg"
              />
              <Text textStyle="caption">Spent by the whole family, per currency. Currencies aren&apos;t converted.</Text>
            </Stack>
          </Card.Body>
        </Card>
      </SimpleGrid>
      <Card overflow="hidden">
        <Card.Header
          title="Recent expenses"
          actions={<CardLink href={hrefFor(`/expenses?month=${data.currentMonth}`)}>View all</CardLink>}
        />
        <Box mt="3" borderTopWidth="1px" borderColor="border">
          <ExpenseList expenses={data.currentExpenses} currency={currency} compact />
        </Box>
      </Card>
    </Stack>
  );
}
