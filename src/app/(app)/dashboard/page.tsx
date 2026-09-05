"use client";

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
import { ArrowRight, CalendarDays, CircleDollarSign, ReceiptText, TrendingUp, WalletCards } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import useSWR from "swr";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { MonthlyBarChart } from "@/components/dashboard/monthly-bar-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatsFilter } from "@/components/dashboard/stats-filter";
import { ExpenseList } from "@/components/expenses/expense-list";
import { DataError, DataLoading, DataUpdating } from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ACCOUNT_API_KEY, dashboardApiKey } from "@/lib/api/keys";
import type { AccountData, DashboardData } from "@/lib/types";
import { parseAnalyticsFilters } from "@/lib/utils/analytics";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import { formatMonth } from "@/lib/utils/dates";

function DashboardContent() {
  useDocumentTitle("Overview");
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseAnalyticsFilters(searchParams), [searchParams]);
  const key = dashboardApiKey(filters);
  const { data, error, isLoading, isValidating, mutate } = useSWR<DashboardData>(key);
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;

  if (isLoading && !data) return <DataLoading label="Loading your overview…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your overview…" />;

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <Stack gap="1">
        <Flex align="center" justify="space-between" gap="3">
          <Text color="purple.600" fontSize="sm" fontWeight="750">OVERVIEW</Text>
          {isValidating ? <DataUpdating /> : null}
        </Flex>
        <Heading as="h1" size={{ base: "2xl", md: "3xl" }} color="gray.900" letterSpacing="-0.045em">
          Your money at a glance
        </Heading>
        <Text color="gray.500">Track patterns, understand spending, and stay in control.</Text>
      </Stack>

      <Box
        position="relative"
        overflow="hidden"
        borderRadius={{ base: "2xl", md: "3xl" }}
        color="white"
        bg="linear-gradient(125deg, #312e81 0%, #6d28d9 58%, #8b5cf6 100%)"
        boxShadow="0 22px 48px rgb(76 29 149 / 22%)"
        p={{ base: "5", sm: "6", md: "8" }}
        _after={{
          content: '""',
          position: "absolute",
          width: "18rem",
          height: "18rem",
          right: "-5rem",
          bottom: "-12rem",
          borderRadius: "full",
          bg: "whiteAlpha.200",
        }}
      >
        <Flex position="relative" zIndex="1" align={{ base: "flex-start", sm: "flex-end" }} justify="space-between" gap="5" direction={{ base: "column", sm: "row" }}>
          <Stack gap="2">
            <Flex align="center" gap="2" color="whiteAlpha.800" fontSize="sm" fontWeight="650">
              <CalendarDays size={16} aria-hidden="true" /> Current month
            </Flex>
            <Heading as="h2" size={{ base: "xl", md: "2xl" }} color="white" letterSpacing="-0.035em">
              {formatMonth(data.currentMonth)}
            </Heading>
            <Text maxW="32rem" color="whiteAlpha.800" fontSize="sm">
              {data.currentCount
                ? `${data.currentCount} ${data.currentCount === 1 ? "expense" : "expenses"} recorded so far.`
                : "Your monthly ledger is ready for its first expense."}
            </Text>
          </Stack>
          <Button asChild bg="white" color="purple.700" borderRadius="xl" _hover={{ bg: "purple.50" }}>
            <Link href={`/expenses?month=${data.currentMonth}`}>
              Open ledger <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </Button>
        </Flex>
      </Box>

      <SimpleGrid columns={{ base: 2, xl: 4 }} gap={{ base: "3", md: "4" }}>
        <StatCard
          label="Spent this month"
          value={formatCurrency(data.currentTotal, currency)}
          helper={`${data.currentCount} entries`}
          icon={<WalletCards size={19} aria-hidden="true" />}
          accent="purple"
        />
        <StatCard
          label="Average expense"
          value={formatCurrency(data.currentAverage, currency)}
          helper="Per transaction"
          icon={<TrendingUp size={19} aria-hidden="true" />}
          accent="blue"
        />
        <StatCard
          label="Largest expense"
          value={formatCurrency(data.currentLargest, currency)}
          helper="This month"
          icon={<CircleDollarSign size={19} aria-hidden="true" />}
          accent="orange"
        />
        <StatCard
          label="Transactions"
          value={String(data.currentCount)}
          helper="Current month"
          icon={<ReceiptText size={19} aria-hidden="true" />}
          accent="green"
        />
      </SimpleGrid>

      <Surface p={{ base: "5", md: "6" }}>
        <Stack gap="5">
          <Flex justify="space-between" align={{ base: "flex-start", xl: "center" }} direction={{ base: "column", xl: "row" }} gap="5">
            <Stack gap="1">
              <Heading as="h2" size="lg" letterSpacing="-0.025em">Spending insights</Heading>
              <Text color="gray.500" fontSize="sm">Compare previous periods without counting the current month.</Text>
            </Stack>
            <StatsFilter
              key={`${filters.period}-${filters.granularity}-${filters.customDate}`}
              initialPeriod={filters.period}
              initialGranularity={filters.granularity}
              initialCustomDate={filters.customDate}
            />
          </Flex>

          <SimpleGrid columns={{ base: 2, xl: 4 }} gap="3">
            <Box p="4" borderRadius="2xl" bg="gray.50">
              <Text color="gray.500" fontSize="xs" fontWeight="650">PERIOD TOTAL</Text>
              <Text mt="1" fontSize={{ base: "lg", md: "xl" }} fontWeight="800" letterSpacing="-0.03em">
                {formatCurrency(data.analytics.total, currency)}
              </Text>
            </Box>
            <Box p="4" borderRadius="2xl" bg="gray.50">
              <Text color="gray.500" fontSize="xs" fontWeight="650">MONTHLY AVERAGE</Text>
              <Text mt="1" fontSize={{ base: "lg", md: "xl" }} fontWeight="800" letterSpacing="-0.03em">
                {formatCurrency(data.analytics.monthlyAverage, currency)}
              </Text>
            </Box>
            <Box p="4" borderRadius="2xl" bg="gray.50">
              <Text color="gray.500" fontSize="xs" fontWeight="650">TRANSACTIONS</Text>
              <Text mt="1" fontSize={{ base: "lg", md: "xl" }} fontWeight="800">{data.analytics.count}</Text>
            </Box>
            <Box p="4" borderRadius="2xl" bg="gray.50">
              <Text color="gray.500" fontSize="xs" fontWeight="650">TOP CATEGORY</Text>
              <Text mt="1" fontSize={{ base: "lg", md: "xl" }} fontWeight="800" truncate>{data.analytics.topCategory}</Text>
            </Box>
          </SimpleGrid>
        </Stack>
      </Surface>

      <SimpleGrid columns={{ base: 1, xl: 3 }} gap="5">
        <Surface p={{ base: "5", md: "6" }} gridColumn={{ xl: "span 2" }}>
          <Stack gap="3">
            <Stack gap="1">
              <Heading as="h2" size="lg" letterSpacing="-0.025em">Monthly trend</Heading>
              <Text color="gray.500" fontSize="sm">{data.analytics.label}</Text>
            </Stack>
            <MonthlyBarChart series={data.analytics.series} currency={currency} />
          </Stack>
        </Surface>

        <Surface p={{ base: "5", md: "6" }}>
          <Stack gap="6">
            <Stack gap="1">
              <Heading as="h2" size="lg" letterSpacing="-0.025em">By category</Heading>
              <Text color="gray.500" fontSize="sm">Where your money went</Text>
            </Stack>
            <CategoryBreakdown items={data.analytics.categoryTotals} currency={currency} />
          </Stack>
        </Surface>
      </SimpleGrid>

      <Surface overflow="hidden">
        <Flex justify="space-between" align="center" gap="4" px={{ base: "5", md: "6" }} pt={{ base: "5", md: "6" }} pb="3">
          <Stack gap="1">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">Recent activity</Heading>
            <Text color="gray.500" fontSize="sm">Latest expenses this month</Text>
          </Stack>
          <ChakraLink asChild color="purple.700" fontSize="sm" fontWeight="700" _hover={{ textDecoration: "none", color: "purple.900" }}>
            <Link href={`/expenses?month=${data.currentMonth}`}>View all</Link>
          </ChakraLink>
        </Flex>
        <ExpenseList expenses={data.currentExpenses} currency={currency} compact />
      </Surface>
    </Stack>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DataLoading label="Loading your overview…" />}>
      <DashboardContent />
    </Suspense>
  );
}
