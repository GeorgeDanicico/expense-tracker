"use client";

import { Button } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { useQuickAdd } from "@/components/quick-add/quick-add-provider";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { defaultDateInMonth, getBucharestToday } from "@/lib/calendar";

/**
 * "Add expense" on a screen that shows a month: opens the quick-add sheet on Expense (the one
 * expense form), dated today in the current month or on the last day of a past one.
 */
export function AddExpenseButton({ selectedMonth }: { selectedMonth: string }) {
  const quickAdd = useQuickAdd();
  return (
    <Button
      variant="solid"
      colorPalette="brand"
      size={{ base: "md", sm: "sm" }}
      flex={{ base: "1 0 auto", sm: "initial" }}
      aria-haspopup="dialog"
      onClick={() => quickAdd.open({ kind: "expense", expenseDate: defaultDateInMonth(selectedMonth, getBucharestToday()) })}
    >
      <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add expense
    </Button>
  );
}
