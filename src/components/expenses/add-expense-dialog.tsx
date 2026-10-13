"use client";

import { Button } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";

export function AddExpenseDialog({
  selectedMonth,
  currency,
}: {
  selectedMonth: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <AppDialog
      title="Add expense"
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button
          variant="solid"
          colorPalette="brand"
          size={{ base: "md", sm: "sm" }}
          flex={{ base: "1", sm: "initial" }}
        >
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add expense
        </Button>
      }
      footer={<FormActions form={formId} submitLabel="Save expense" closesDialog pending={pending} />}
    >
      <ExpenseForm
        id={formId}
        selectedMonth={selectedMonth}
        currency={currency}
        onPendingChange={setPending}
        onSuccess={() => setOpen(false)}
      />
    </AppDialog>
  );
}
