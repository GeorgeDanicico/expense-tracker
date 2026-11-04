"use client";

import { useState } from "react";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { AppDialog } from "@/components/ui/app-dialog";
import type { Expense } from "@/lib/expenses/types";

/**
 * A row's Edit: the expense form in a sheet (a centred dialog on desktop), filled in. Saving shows the
 * change at once, rolled back if the server refuses it (`useExpenseWrites().edit`); a new date moves
 * the expense to that date's month.
 */
export function EditExpenseSheet({ expense, currency, onClose }: { expense: Expense | null; currency: string; onClose: () => void }) {
  // Kept while the sheet slides away, so its form doesn't empty under it; each opening starts a fresh form.
  const [shown, setShown] = useState({ expense, opening: 0 });
  if (expense && expense !== shown.expense) setShown({ expense, opening: shown.opening + 1 });
  return (
    <AppDialog open={expense !== null} onOpenChange={(open) => (open ? undefined : onClose())} title="Edit expense" size="sm" closeLabel="Close">
      {shown.expense ? <ExpenseForm key={shown.opening} currency={currency} expense={shown.expense} onSaved={onClose} /> : null}
    </AppDialog>
  );
}
