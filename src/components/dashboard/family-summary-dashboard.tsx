"use client";

import { Box, chakra, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import useSWR from "swr";

import { CurrencyAmounts } from "@/components/expenses/currency-totals";
import { ExpenseList } from "@/components/expenses/expense-list";
import { CategoryBreakdownChart, MonthlyTrendChart } from "@/components/dashboard/family-spending-charts";
import { MemberName } from "@/components/family/member-swatch";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { CardLink } from "@/components/ui/card-link";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Stat, StatGroup } from "@/components/ui/stat";
import { useMemberColors } from "@/hooks/use-member-colors";
import { useViewing } from "@/hooks/use-viewing";
import { dashboardApiKey, withMember } from "@/lib/api/keys";
import { formatMonth, getBucharestMonth } from "@/lib/calendar";
import { currenciesByTotal, membersIn, monthShares } from "@/lib/expenses/family-charts";
import type { FamilyDashboardData } from "@/lib/expenses/types";
import { formatCurrency } from "@/lib/utils/currency";

const GAP = "2px";

/** The family view of the summary: this month and the last three, combined per currency, and who spent it. */
export function FamilySummaryDashboard() {
  const { member, currency, hrefFor } = useViewing();
  const { data, error, isValidating, mutate } = useSWR<FamilyDashboardData>(
    dashboardApiKey({ period: "3m", granularity: "month", customDate: getBucharestMonth() }, member),
    { keepPreviousData: false },
  );
  const memberColor = useMemberColors();
  const [selected, setSelected] = useState<string | null>(null);
  const [chosenCurrency, setCurrency] = useState<string | null>(null);
  if (!data)
    return error ? <DataError retry={() => void mutate()} /> : <DataLoading label="Loading summary…" />;

  // The charts show one currency at a time (amounts of different currencies are never added): the
  // largest by default, or the one picked in the switcher.
  const currencies = currenciesByTotal(data.members);
  const activeCurrency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : (currencies[0] ?? currency);
  const inCurrency = membersIn(data.members, activeCurrency);
  const { total, shares } = monthShares(inCurrency);
  const selectedMember = inCurrency.find((member) => member.memberId === selected) ?? null;
  const recent = data.currentExpenses.filter(
    (expense) =>
      (!selectedMember || expense.memberId === selectedMember.memberId) &&
      (!currencies.length || expense.currency === activeCurrency),
  );

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
      {currencies.length > 1 ? (
        <Flex align="center" gap="3" wrap="wrap">
          <Text textStyle="label">Currency</Text>
          <SegmentedControl
            aria-label="Currency shown in the charts"
            items={currencies.map((code) => ({ value: code, label: code }))}
            value={activeCurrency}
            onValueChange={(code) => {
              setCurrency(code);
              setSelected(null);
            }}
          />
          <Text textStyle="caption">Currencies aren&apos;t converted, so each chart shows one at a time.</Text>
        </Flex>
      ) : null}
      <Card>
        <Card.Header title="This month by member" description={`${formatMonth(data.currentMonth)}, in ${activeCurrency}`} />
        <Card.Body>
          <Stack gap="4">
            <Amount value={total} currency={activeCurrency} size="hero" />
            <Flex gap={GAP} h="4" role="group" aria-label="Each member's share of this month's spending">
              {shares
                .filter((share) => share.total > 0)
                .map((share) => (
                  <chakra.button
                    key={share.memberId}
                    type="button"
                    flex={`${share.total} 1 0`}
                    minW="1"
                    bg={memberColor(share.memberId) ?? "fg.subtle"}
                    borderRadius="sm"
                    cursor="pointer"
                    opacity={selected && selected !== share.memberId ? 0.3 : 1}
                    transition="opacity 0.15s"
                    aria-pressed={selected === share.memberId}
                    aria-label={`${share.name}, ${formatCurrency(share.total, activeCurrency)}, ${Math.round(share.share)}%`}
                    title={`${share.name}: ${formatCurrency(share.total, activeCurrency)}`}
                    onClick={() => setSelected(selected === share.memberId ? null : share.memberId)}
                    _focusVisible={{ outline: "2px solid", outlineColor: "fg", outlineOffset: "1px" }}
                  />
                ))}
            </Flex>
            <Stack as="ul" gap="1" m="0" p="0" listStyleType="none">
              {shares.map((share) => (
                <Box as="li" key={share.memberId}>
                  <chakra.button
                    type="button"
                    display="flex"
                    w="full"
                    alignItems="center"
                    justifyContent="space-between"
                    gap="3"
                    px="2"
                    py="1.5"
                    borderRadius="control"
                    borderWidth="1px"
                    borderColor={selected === share.memberId ? "border.emphasized" : "transparent"}
                    bg={selected === share.memberId ? "bg.subtle" : undefined}
                    textAlign="left"
                    cursor="pointer"
                    _hover={{ bg: "bg.subtle" }}
                    aria-pressed={selected === share.memberId}
                    onClick={() => setSelected(selected === share.memberId ? null : share.memberId)}
                  >
                    <Text textStyle="bodySm" fontWeight="medium" truncate minW="0">
                      <MemberName memberId={share.memberId} name={share.name} />
                    </Text>
                    <Flex align="baseline" gap="2" flexShrink="0">
                      <Amount value={share.total} currency={activeCurrency} size="sm" />
                      <Text textStyle="caption" minW="9" textAlign="right">{Math.round(share.share)}%</Text>
                    </Flex>
                  </chakra.button>
                </Box>
              ))}
            </Stack>
            {selectedMember ? (
              <Flex justify="space-between" align="center" gap="3" wrap="wrap">
                <Text textStyle="caption">
                  {selectedMember.name} is highlighted in every chart.{" "}
                  {selectedMember.count === 1 ? "1 transaction" : `${selectedMember.count} transactions`} this month.
                </Text>
                <CardLink href={withMember("/dashboard", selectedMember.memberId)}>{`${selectedMember.name}'s dashboard`}</CardLink>
              </Flex>
            ) : null}
          </Stack>
        </Card.Body>
      </Card>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
        <Card>
          <Card.Header
            title="Monthly trend"
            description="The last three completed months and this one, by member"
          />
          <Card.Body>
            <MonthlyTrendChart
              members={inCurrency}
              currency={activeCurrency}
              currentMonth={data.currentMonth}
              selected={selected}
              onSelect={setSelected}
            />
          </Card.Body>
        </Card>
        <Card>
          <Card.Header
            title="Where the money goes"
            description={`${data.analyticsLabel || "Previous three completed months"}, by category and member`}
          />
          <Card.Body>
            <CategoryBreakdownChart members={inCurrency} currency={activeCurrency} selected={selected} onSelect={setSelected} />
          </Card.Body>
        </Card>
      </SimpleGrid>
      <Card overflow="hidden">
        <Card.Header
          title={selectedMember ? `Recent expenses, ${selectedMember.name}` : "Recent expenses"}
          actions={<CardLink href={hrefFor(`/expenses?month=${data.currentMonth}`)}>View all</CardLink>}
        />
        <Box mt="3" borderTopWidth="1px" borderColor="border">
          <ExpenseList expenses={recent} currency={activeCurrency} compact />
        </Box>
      </Card>
    </Stack>
  );
}
