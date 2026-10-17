import { Box, Flex, Stack, Table, Text } from "@chakra-ui/react";

import { CategoryVisual } from "@/components/expenses/category-visual";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { Amount } from "@/components/ui/amount";
import { MemberSwatch } from "@/components/family/member-swatch";
import { CategoryBadge } from "@/components/ui/status-badge";
import { useMemberColors } from "@/hooks/use-member-colors";
import type { ListedExpense } from "@/lib/expenses/types";
import { formatDate } from "@/lib/calendar";

/**
 * Desktop expense table: 40px rows, numeric amounts, quiet row actions. In the family view each row
 * has a start border in its member's colour, and the Member column repeats it beside the name.
 */
export function ExpenseTable({
  expenses,
  currency,
  allowDelete,
}: {
  expenses: ListedExpense[];
  currency: string;
  allowDelete: boolean;
}) {
  const showMember = expenses.some((expense) => expense.memberName);
  const memberColor = useMemberColors();
  return (
    <Box display={{ base: "none", lg: "block" }} overflowX="auto">
      <Table.Root interactive>
        <Table.Caption className="sr-only">Expense transactions</Table.Caption>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader ps="4">Transaction</Table.ColumnHeader>
            {showMember ? <Table.ColumnHeader>Member</Table.ColumnHeader> : null}
            <Table.ColumnHeader>Date</Table.ColumnHeader>
            <Table.ColumnHeader>Category</Table.ColumnHeader>
            <Table.ColumnHeader data-numeric pe={allowDelete ? "3" : "4"}>Amount</Table.ColumnHeader>
            {allowDelete ? (
              <Table.ColumnHeader width="10" pe="3">
                <span className="sr-only">Actions</span>
              </Table.ColumnHeader>
            ) : null}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {expenses.map((expense) => {
            const color = showMember ? memberColor(expense.memberId) : undefined;
            return (
            <Table.Row key={expense.id}>
              <Table.Cell ps="4" borderInlineStartWidth={color ? "4px" : undefined} borderInlineStartColor={color}>
                <Flex align="center" gap="2.5">
                  <CategoryVisual category={expense.category} />
                  <Stack minW="0" gap="0">
                    <Text maxW={{ lg: "16rem", xl: "26rem" }} fontWeight="medium" truncate>
                      {expense.description}
                    </Text>
                    {expense.notes ? (
                      <Text maxW={{ lg: "16rem", xl: "26rem" }} textStyle="caption" truncate>
                        {expense.notes}
                      </Text>
                    ) : null}
                  </Stack>
                </Flex>
              </Table.Cell>
              {showMember ? (
                <Table.Cell whiteSpace="nowrap">
                  <Flex as="span" align="center" gap="2">
                    <MemberSwatch color={color} />
                    {expense.memberName}
                  </Flex>
                </Table.Cell>
              ) : null}
              <Table.Cell color="fg.muted" whiteSpace="nowrap">{formatDate(expense.expenseDate)}</Table.Cell>
              <Table.Cell>
                <CategoryBadge category={expense.category} subtype={expense.subtype} />
              </Table.Cell>
              <Table.Cell data-numeric pe={allowDelete ? "3" : "4"}>
                <Amount value={expense.amount} currency={expense.currency ?? currency} size="sm" />
              </Table.Cell>
              {allowDelete ? (
                <Table.Cell pe="3" textAlign="end">
                  <Box data-row-action display="inline-flex">
                    <DeleteExpenseButton id={expense.id} description={expense.description} />
                  </Box>
                </Table.Cell>
              ) : null}
            </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
