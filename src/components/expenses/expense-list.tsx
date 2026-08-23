import {
  Badge,
  Box,
  Flex,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";

import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { CATEGORY_LABELS, type Expense } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";

export function ExpenseList({
  expenses,
  currency,
  compact = false,
  allowDelete = false,
}: {
  expenses: Expense[];
  currency: string;
  compact?: boolean;
  allowDelete?: boolean;
}) {
  if (!expenses.length) {
    return (
      <Box py="10" textAlign="center">
        <Text fontWeight="medium">No expenses recorded.</Text>
        <Text fontSize="sm" color="gray.500">Add the first entry for this period.</Text>
      </Box>
    );
  }

  const shown = compact ? expenses.slice(0, 5) : expenses;

  return (
    <>
      <Box display={{ base: "none", md: "block" }} overflowX="auto">
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Date</Table.ColumnHeader>
              <Table.ColumnHeader>Description</Table.ColumnHeader>
              <Table.ColumnHeader>Category</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Amount</Table.ColumnHeader>
              {allowDelete ? <Table.ColumnHeader width="12"><span className="sr-only">Actions</span></Table.ColumnHeader> : null}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {shown.map((expense) => (
              <Table.Row key={expense.id}>
                <Table.Cell color="gray.600" whiteSpace="nowrap">{formatDate(expense.expenseDate)}</Table.Cell>
                <Table.Cell>
                  <Text fontWeight="medium">{expense.description}</Text>
                  {expense.notes ? <Text fontSize="xs" color="gray.500" lineClamp="1">{expense.notes}</Text> : null}
                </Table.Cell>
                <Table.Cell><Badge variant="subtle">{CATEGORY_LABELS[expense.category]}</Badge></Table.Cell>
                <Table.Cell textAlign="end" fontWeight="semibold">{formatCurrency(expense.amount, currency)}</Table.Cell>
                {allowDelete ? (
                  <Table.Cell>
                    <DeleteExpenseButton id={expense.id} description={expense.description} />
                  </Table.Cell>
                ) : null}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <Stack display={{ base: "flex", md: "none" }} gap="0" separator={<Box borderTopWidth="1px" borderColor="gray.100" />}>
        {shown.map((expense) => (
          <Flex key={expense.id} py="4" justify="space-between" gap="4" align="start">
            <Stack gap="1" minW="0">
              <Text fontWeight="medium" truncate>{expense.description}</Text>
              <Text fontSize="xs" color="gray.500">
                {formatDate(expense.expenseDate)} · {CATEGORY_LABELS[expense.category]}
              </Text>
            </Stack>
            <Text fontWeight="semibold" whiteSpace="nowrap">{formatCurrency(expense.amount, currency)}</Text>
            {allowDelete ? (
              <DeleteExpenseButton id={expense.id} description={expense.description} />
            ) : null}
          </Flex>
        ))}
      </Stack>
    </>
  );
}
