"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Textarea,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { createExpenseAction } from "@/app/(app)/expenses/actions";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, INITIAL_ACTION_STATE } from "@/lib/types";
import { getMonthRange } from "@/lib/utils/dates";

function ExpenseForm({
  selectedMonth,
  currency,
  onSuccess,
}: {
  selectedMonth: string;
  currency: string;
  onSuccess: () => void;
}) {
  const createForSelectedMonth = createExpenseAction.bind(null, selectedMonth);
  const [state, formAction, pending] = useActionState(
    createForSelectedMonth,
    INITIAL_ACTION_STATE,
  );
  const range = getMonthRange(selectedMonth);
  const endDate = new Date(`${range.endExclusive}T12:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const maxDate = endDate.toISOString().slice(0, 10);

  useEffect(() => {
    if (state.status === "success") onSuccess();
  }, [onSuccess, state.status]);

  return (
    <form action={formAction}>
      <Stack gap="4">
        <Field.Root invalid={Boolean(state.fieldErrors?.description)}>
          <Field.Label>Description</Field.Label>
          <Input name="description" maxLength={120} autoFocus required />
          <Field.ErrorText>{state.fieldErrors?.description?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.amount)}>
          <Field.Label>Amount ({currency})</Field.Label>
          <Input name="amount" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" required />
          <Field.ErrorText>{state.fieldErrors?.amount?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.category)}>
          <Field.Label>Category</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field name="category" defaultValue="groceries">
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Field.ErrorText>{state.fieldErrors?.category?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.expenseDate)}>
          <Field.Label>Date</Field.Label>
          <Input
            name="expenseDate"
            type="date"
            defaultValue={maxDate}
            min={range.start}
            max={maxDate}
            required
          />
          <Field.HelperText>The date must be inside the selected month.</Field.HelperText>
          <Field.ErrorText>{state.fieldErrors?.expenseDate?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.notes)}>
          <Field.Label>Notes <span aria-hidden="true">(optional)</span></Field.Label>
          <Textarea name="notes" maxLength={500} rows={3} />
          <Field.ErrorText>{state.fieldErrors?.notes?.[0]}</Field.ErrorText>
        </Field.Root>

        {state.status === "error" ? (
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Description>{state.message}</Alert.Description>
          </Alert.Root>
        ) : null}

        <Button type="submit" colorPalette="blue" loading={pending}>Save expense</Button>
      </Stack>
    </form>
  );
}

export function AddExpenseDialog({
  selectedMonth,
  currency,
}: {
  selectedMonth: string;
  currency: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} size="sm">
      <Dialog.Trigger asChild>
        <Button colorPalette="blue">
          <Plus size={17} aria-hidden="true" /> Add expense
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Add expense</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {open ? (
                <ExpenseForm
                  selectedMonth={selectedMonth}
                  currency={currency}
                  onSuccess={() => setOpen(false)}
                />
              ) : null}
            </Dialog.Body>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
