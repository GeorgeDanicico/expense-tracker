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
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatCard } from "@/components/dashboard/stat-card";
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog";
import { ExpenseList } from "@/components/expenses/expense-list";
import { getAccountCurrency } from "@/lib/data/account";
import { getMonthlyExpenses } from "@/lib/data/expenses";
import { formatCurrency } from "@/lib/utils/currency";
import {
  formatMonth,
  getCurrentMonth,
  isValidMonth,
  shiftMonth,
} from "@/lib/utils/dates";

export const metadata: Metadata = { title: "Expenses" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const requested = Array.isArray(params.month) ? params.month[0] : params.month;
  const month = requested && isValidMonth(requested) ? requested : getCurrentMonth();
  const [expenses, currency] = await Promise.all([
    getMonthlyExpenses(month),
    getAccountCurrency(),
  ]);
  let total = 0;
  for (const expense of expenses) total += expense.amount;
  const average = expenses.length ? total / expenses.length : 0;

  return (
    <Stack gap="8">
      <Flex justify="space-between" align={{ base: "start", lg: "end" }} gap="5" direction={{ base: "column", lg: "row" }}>
        <Stack gap="1">
          <Text color="gray.500" fontSize="sm">Monthly ledger</Text>
          <Heading as="h1" size="2xl">{formatMonth(month)}</Heading>
        </Stack>

        <Flex gap="3" wrap="wrap">
          <Button asChild variant="outline">
            <Link href={`/api/expenses/export?month=${month}`}>
              <Download size={17} aria-hidden="true" /> Export Excel
            </Link>
          </Button>
          <AddExpenseDialog selectedMonth={month} currency={currency} />
        </Flex>
      </Flex>

      <Box bg="white" borderWidth="1px" borderColor="gray.200" p="5">
        <Flex align="end" justify="space-between" gap="4" wrap="wrap">
          <HStack gap="2">
            <Button asChild variant="outline" size="sm" aria-label="Previous month">
              <Link href={`/expenses?month=${shiftMonth(month, -1)}`}>
                <ChevronLeft size={17} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" aria-label="Next month">
              <Link href={`/expenses?month=${shiftMonth(month, 1)}`}>
                <ChevronRight size={17} aria-hidden="true" />
              </Link>
            </Button>
          </HStack>

          <form method="get">
            <Flex gap="2" align="end">
              <Field.Root>
                <Field.Label>Select month and year</Field.Label>
                <Input name="month" type="month" defaultValue={month} required />
              </Field.Root>
              <Button type="submit" variant="outline">Go</Button>
            </Flex>
          </form>
        </Flex>
      </Box>

      <SimpleGrid columns={{ base: 1, sm: 3 }} gap="4">
        <StatCard label="Month total" value={formatCurrency(total, currency)} helper={formatMonth(month)} />
        <StatCard label="Expenses" value={String(expenses.length)} helper="Recorded entries" />
        <StatCard label="Average" value={formatCurrency(average, currency)} helper="Per expense" />
      </SimpleGrid>

      <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }}>
        <Stack gap="5">
          <Stack gap="1">
            <Heading as="h2" size="lg">All expenses</Heading>
            <Text color="gray.500" fontSize="sm">{formatMonth(month)} · sorted newest first</Text>
          </Stack>
          <ExpenseList expenses={expenses} currency={currency} allowDelete />
        </Stack>
      </Box>
    </Stack>
  );
}
