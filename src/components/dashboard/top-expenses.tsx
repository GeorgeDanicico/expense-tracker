import { Flex, Stack, Text } from "@chakra-ui/react";

import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import type { Expense } from "@/lib/types";
import { formatDate } from "@/lib/calendar";

/** Ranked list of the month's largest expenses. */
export function TopExpenses({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  return (
    <Card>
      <Card.Header title="Largest recorded expenses" />
      <Card.Body>
        {expenses.length ? (
          <Stack as="ol" gap="2.5" listStyleType="none">
            {expenses.map((expense, index) => (
              <Flex as="li" key={expense.id} gap="3" align="baseline">
                <Text textStyle="caption" width="4" flexShrink="0">{index + 1}.</Text>
                <Stack flex="1" minW="0" gap="0">
                  <Text textStyle="bodySm" truncate>{expense.description}</Text>
                  <Text textStyle="caption">{formatDate(expense.expenseDate)}</Text>
                </Stack>
                <Amount value={expense.amount} currency={currency} size="sm" />
              </Flex>
            ))}
          </Stack>
        ) : (
          <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>
        )}
      </Card.Body>
    </Card>
  );
}
