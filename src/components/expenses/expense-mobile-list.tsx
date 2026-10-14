import { Box } from "@chakra-ui/react";

import { CategoryVisual } from "@/components/expenses/category-visual";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { Amount } from "@/components/ui/amount";
import { ListRow } from "@/components/ui/list-row";
import { expenseClassificationLabel } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { formatDate } from "@/lib/calendar";

/** Mobile expense rows: icon, description, date · category, amount. */
export function ExpenseMobileList({
  expenses,
  currency,
  allowDelete,
}: {
  expenses: Expense[];
  currency: string;
  allowDelete: boolean;
}) {
  return (
    <Box as="ul" display={{ base: "block", lg: "none" }} px="4" m="0">
      {expenses.map((expense) => (
        <ListRow
          key={expense.id}
          leading={<CategoryVisual category={expense.category} />}
          title={expense.description}
          meta={`${formatDate(expense.expenseDate)} · ${expenseClassificationLabel(expense.category, expense.subtype)}`}
          detail={expense.notes}
          trailing={<Amount value={expense.amount} currency={currency} size="sm" />}
          actions={
            allowDelete ? <DeleteExpenseButton id={expense.id} description={expense.description} /> : null
          }
        />
      ))}
    </Box>
  );
}
