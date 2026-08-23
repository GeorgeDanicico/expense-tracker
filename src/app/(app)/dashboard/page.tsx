import {
  Box,
  Button,
  Flex,
  Heading,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { Metadata } from "next";
import Link from "next/link";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatsFilter } from "@/components/dashboard/stats-filter";
import { ExpenseList } from "@/components/expenses/expense-list";
import { getAccountCurrency } from "@/lib/data/account";
import {
  getDashboardData,
  type AnalyticsPeriod,
  type CustomGranularity,
} from "@/lib/data/expenses";
import { formatCurrency } from "@/lib/utils/currency";
import { formatMonth, getCurrentMonth, isValidDate, isValidMonth } from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(params: Awaited<SearchParams>) {
  const rawPeriod = first(params.period);
  const period: AnalyticsPeriod = ["3m", "6m", "1y", "2y", "custom"].includes(
    rawPeriod ?? "",
  )
    ? (rawPeriod as AnalyticsPeriod)
    : "3m";
  const granularity: CustomGranularity =
    first(params.granularity) === "day" ? "day" : "month";
  const rawDate = first(params.date) ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const customDate =
    granularity === "day"
      ? isValidDate(rawDate)
        ? rawDate
        : today
      : isValidMonth(rawDate)
        ? rawDate
        : getCurrentMonth();

  return { period, granularity, customDate };
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(await searchParams);
  const [data, currency] = await Promise.all([
    getDashboardData(filters),
    getAccountCurrency(),
  ]);

  return (
    <Stack gap="8">
      <Flex justify="space-between" align={{ base: "start", sm: "end" }} gap="4" direction={{ base: "column", sm: "row" }}>
        <Stack gap="1">
          <Text color="gray.500" fontSize="sm">Current month</Text>
          <Heading as="h1" size="2xl">{formatMonth(data.currentMonth)}</Heading>
        </Stack>
        <Button asChild colorPalette="blue">
          <Link href={`/expenses?month=${data.currentMonth}`}>Open monthly ledger</Link>
        </Button>
      </Flex>

      <SimpleGrid columns={{ base: 1, sm: 2, lg: 4 }} gap="4">
        <StatCard label="Spent this month" value={formatCurrency(data.currentTotal, currency)} helper={`${data.currentCount} entries`} />
        <StatCard label="Average expense" value={formatCurrency(data.currentAverage, currency)} helper="Per recorded entry" />
        <StatCard label="Largest expense" value={formatCurrency(data.currentLargest, currency)} helper="This month" />
        <StatCard label="Entries" value={String(data.currentCount)} helper="Current month" />
      </SimpleGrid>

      <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }}>
        <Stack gap="5">
          <Flex justify="space-between" align={{ base: "start", lg: "center" }} direction={{ base: "column", lg: "row" }} gap="4">
            <Stack gap="1">
              <Heading as="h2" size="lg">Historical statistics</Heading>
              <Text color="gray.500" fontSize="sm">Compare patterns before the current month.</Text>
            </Stack>
            <StatsFilter
              initialPeriod={filters.period}
              initialGranularity={filters.granularity}
              initialCustomDate={filters.customDate}
            />
          </Flex>

          <SimpleGrid columns={{ base: 2, lg: 4 }} gap="4">
            <StatCard label="Period total" value={formatCurrency(data.analytics.total, currency)} helper={data.analytics.label} />
            <StatCard label="Monthly average" value={formatCurrency(data.analytics.monthlyAverage, currency)} helper="Selected range" />
            <StatCard label="Transactions" value={String(data.analytics.count)} helper={data.analytics.label} />
            <StatCard label="Top category" value={data.analytics.topCategory} helper="By total amount" />
          </SimpleGrid>
        </Stack>
      </Box>

      <SimpleGrid columns={{ base: 1, lg: 3 }} gap="5">
        <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }} gridColumn={{ lg: "span 2" }}>
          <Stack gap="5">
            <Stack gap="1">
              <Heading as="h2" size="lg">Monthly trend</Heading>
              <Text color="gray.500" fontSize="sm">{data.analytics.label}</Text>
            </Stack>
            <MonthlyBarChart series={data.analytics.series} currency={currency} />
          </Stack>
        </Box>

        <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }}>
          <Stack gap="5">
            <Stack gap="1">
              <Heading as="h2" size="lg">By category</Heading>
              <Text color="gray.500" fontSize="sm">Largest groups in the selected period</Text>
            </Stack>
            <CategoryBreakdown items={data.analytics.categoryTotals} currency={currency} />
          </Stack>
        </Box>
      </SimpleGrid>

      <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }}>
        <Stack gap="4">
          <Flex justify="space-between" align="center" gap="4">
            <Stack gap="1">
              <Heading as="h2" size="lg">Latest expenses</Heading>
              <Text color="gray.500" fontSize="sm">Most recent entries this month</Text>
            </Stack>
            <ChakraLink asChild color="blue.700" fontWeight="semibold">
              <Link href={`/expenses?month=${data.currentMonth}`}>View all</Link>
            </ChakraLink>
          </Flex>
          <ExpenseList expenses={data.currentExpenses} currency={currency} compact />
        </Stack>
      </Box>
    </Stack>
  );
}
