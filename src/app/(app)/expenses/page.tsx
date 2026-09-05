"use client";

import {
  Box,
  Button,
  Field,
  Flex,
  Heading,
  HStack,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Calculator, ChevronLeft, ChevronRight, Download, ReceiptText, WalletCards } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense } from "react";
import useSWR from "swr";

import { StatCard } from "@/components/dashboard/stat-card";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { ExpenseList } from "@/components/expenses/expense-list";
import { DataError, DataLoading, DataUpdating } from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ACCOUNT_API_KEY, expensesApiKey } from "@/lib/api/keys";
import type { AccountData, ExpensesData } from "@/lib/types";
import { DEFAULT_CURRENCY, formatCurrency } from "@/lib/utils/currency";
import {
  formatMonth,
  getCurrentMonth,
  isValidMonth,
  shiftMonth,
} from "@/lib/utils/dates";

function ExpensesContent() {
  useDocumentTitle("Expenses");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("month");
  const month = requested && isValidMonth(requested) ? requested : getCurrentMonth();
  const key = expensesApiKey(month);
  const { data, error, isLoading, isValidating, mutate } = useSWR<ExpensesData>(key);
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const currency = account?.currency ?? DEFAULT_CURRENCY;

  function jumpToMonth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextMonth = formData.get("month");
    if (typeof nextMonth === "string" && isValidMonth(nextMonth)) {
      router.push(`/expenses?month=${nextMonth}`);
    }
  }

  if (isLoading && !data) return <DataLoading label="Loading your expenses…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your expenses…" />;

  const { expenses, total, average } = data;

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <Flex justify="space-between" align={{ base: "flex-start", lg: "flex-end" }} gap="5" direction={{ base: "column", lg: "row" }}>
        <Stack gap="1">
          <Flex align="center" gap="3">
            <Text color="purple.600" fontSize="sm" fontWeight="750">MONTHLY LEDGER</Text>
            {isValidating ? <DataUpdating /> : null}
          </Flex>
          <Heading as="h1" size={{ base: "2xl", md: "3xl" }} color="gray.900" letterSpacing="-0.045em">
            {formatMonth(month)}
          </Heading>
          <Text color="gray.500">Review, search, and manage every expense for this month.</Text>
        </Stack>

        <Flex width={{ base: "full", sm: "auto" }} gap="3">
          <Button asChild flex={{ base: "1", sm: "initial" }} variant="outline" borderRadius="xl" borderColor="gray.300">
            <Link href={`/api/expenses/export?month=${month}`}>
              <Download size={17} aria-hidden="true" /> Export
            </Link>
          </Button>
          <AddExpenseDialog selectedMonth={month} currency={currency} />
        </Flex>
      </Flex>

      <Surface p={{ base: "4", md: "5" }}>
        <Flex align={{ base: "stretch", sm: "flex-end" }} justify="space-between" gap="4" direction={{ base: "column", sm: "row" }}>
          <Stack gap="1">
            <Text color="gray.500" fontSize="xs" fontWeight="700" letterSpacing="0.08em">BROWSE MONTHS</Text>
            <HStack gap="2">
              <Button asChild variant="outline" size="sm" borderRadius="lg" aria-label="Previous month">
                <Link href={`/expenses?month=${shiftMonth(month, -1)}`}>
                  <ChevronLeft size={17} aria-hidden="true" />
                </Link>
              </Button>
              <Text minW={{ base: "9rem", md: "11rem" }} textAlign="center" fontWeight="700">
                {formatMonth(month)}
              </Text>
              <Button asChild variant="outline" size="sm" borderRadius="lg" aria-label="Next month">
                <Link href={`/expenses?month=${shiftMonth(month, 1)}`}>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              </Button>
            </HStack>
          </Stack>

          <form onSubmit={jumpToMonth}>
            <Flex gap="2" align="end">
              <Field.Root>
                <Field.Label>Jump to month</Field.Label>
                <Input name="month" type="month" size="sm" minW={{ base: "0", sm: "180px" }} defaultValue={month} required />
              </Field.Root>
              <Button type="submit" size="sm" variant="outline" borderRadius="lg">Go</Button>
            </Flex>
          </form>
        </Flex>
      </Surface>

      <SimpleGrid columns={{ base: 1, sm: 3 }} gap={{ base: "3", md: "4" }}>
        <StatCard
          label="Month total"
          value={formatCurrency(total, currency)}
          helper={formatMonth(month)}
          icon={<WalletCards size={19} aria-hidden="true" />}
          accent="purple"
        />
        <StatCard
          label="Transactions"
          value={String(expenses.length)}
          helper="Recorded expenses"
          icon={<ReceiptText size={19} aria-hidden="true" />}
          accent="green"
        />
        <StatCard
          label="Average"
          value={formatCurrency(average, currency)}
          helper="Per transaction"
          icon={<Calculator size={19} aria-hidden="true" />}
          accent="blue"
        />
      </SimpleGrid>

      <Surface overflow="hidden">
        <Box px={{ base: "5", md: "6" }} pt={{ base: "5", md: "6" }} pb="3">
          <Heading as="h2" size="lg" letterSpacing="-0.025em">All expenses</Heading>
          <Text mt="1" color="gray.500" fontSize="sm">Newest transactions appear first.</Text>
        </Box>
        <ExpenseList expenses={expenses} currency={currency} allowDelete />
      </Surface>
    </Stack>
  );
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<DataLoading label="Loading your expenses…" />}>
      <ExpensesContent />
    </Suspense>
  );
}
