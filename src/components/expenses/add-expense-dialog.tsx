"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Textarea,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { expensesApiKey } from "@/lib/api/keys";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  INITIAL_ACTION_STATE,
  type ActionState,
  type Expense,
  type ExpensesData,
} from "@/lib/types";
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
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<ActionState>(INITIAL_ACTION_STATE);
  const [pending, setPending] = useState(false);
  const range = getMonthRange(selectedMonth);
  const endDate = new Date(`${range.endExclusive}T12:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const maxDate = endDate.toISOString().slice(0, 10);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(INITIAL_ACTION_STATE);

    const formData = new FormData(event.currentTarget);
    try {
      const { expense } = await apiRequest<{ expense: Expense }>("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          selectedMonth,
          description: formData.get("description"),
          amount: formData.get("amount"),
          category: formData.get("category"),
          expenseDate: formData.get("expenseDate"),
          notes: formData.get("notes"),
        }),
      });

      await mutate(
        expensesApiKey(selectedMonth),
        (current: ExpensesData | undefined) => {
          if (!current) return current;
          const expenses = [expense, ...current.expenses];
          const total = current.total + expense.amount;
          return { ...current, expenses, total, average: total / expenses.length };
        },
        { revalidate: false },
      );
      void mutate(
        (cacheKey) => typeof cacheKey === "string" && cacheKey.startsWith("/api/dashboard?"),
        undefined,
        { revalidate: true },
      );
      onSuccess();
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "The expense could not be saved.",
        fieldErrors: error instanceof ApiError ? error.fieldErrors : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="4.5">
        <Field.Root invalid={Boolean(state.fieldErrors?.description)}>
          <Field.Label>Description</Field.Label>
          <Input name="description" maxLength={120} placeholder="e.g. Weekly groceries" autoFocus required borderRadius="xl" />
          <Field.ErrorText>{state.fieldErrors?.description?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.amount)}>
          <Field.Label>Amount ({currency})</Field.Label>
          <Input name="amount" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" required borderRadius="xl" />
          <Field.ErrorText>{state.fieldErrors?.amount?.[0]}</Field.ErrorText>
        </Field.Root>

        <Flex gap="4" direction={{ base: "column", sm: "row" }}>
          <Field.Root flex="1" invalid={Boolean(state.fieldErrors?.category)}>
            <Field.Label>Category</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field name="category" defaultValue="groceries" borderRadius="xl">
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            <Field.ErrorText>{state.fieldErrors?.category?.[0]}</Field.ErrorText>
          </Field.Root>

          <Field.Root flex="1" invalid={Boolean(state.fieldErrors?.expenseDate)}>
            <Field.Label>Date</Field.Label>
            <Input
              name="expenseDate"
              type="date"
              defaultValue={maxDate}
              min={range.start}
              max={maxDate}
              required
              borderRadius="xl"
            />
            <Field.ErrorText>{state.fieldErrors?.expenseDate?.[0]}</Field.ErrorText>
          </Field.Root>
        </Flex>

        <Field.Root invalid={Boolean(state.fieldErrors?.notes)}>
          <Field.Label>Notes <span aria-hidden="true">(optional)</span></Field.Label>
          <Textarea name="notes" maxLength={500} rows={3} placeholder="Add an optional note" borderRadius="xl" resize="vertical" />
          <Field.ErrorText>{state.fieldErrors?.notes?.[0]}</Field.ErrorText>
        </Field.Root>

        {state.status === "error" ? (
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Description>{state.message}</Alert.Description>
          </Alert.Root>
        ) : null}

        <Button type="submit" colorPalette="purple" borderRadius="xl" loading={pending}>Save expense</Button>
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
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} size="md">
      <Dialog.Trigger asChild>
        <Button flex={{ base: "1", sm: "initial" }} colorPalette="purple" borderRadius="xl" boxShadow="0 8px 18px rgb(124 58 237 / 16%)">
          <Plus size={17} aria-hidden="true" /> Add expense
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(4px)" />
        <Dialog.Positioner alignItems={{ base: "flex-end", sm: "center" }} p={{ base: "0", sm: "4" }}>
          <Dialog.Content
            maxH={{ base: "calc(100dvh - env(safe-area-inset-top) - 1rem)", sm: "90dvh" }}
            borderRadius={{ base: "2xl 2xl 0 0", sm: "3xl" }}
            boxShadow="2xl"
            overflowY="auto"
          >
            <Dialog.Header>
              <Stack gap="1">
                <Dialog.Title>Add an expense</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  Record a transaction in this month’s ledger.
                </Dialog.Description>
              </Stack>
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
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" borderRadius="lg" aria-label="Close dialog">
                <X size={17} aria-hidden="true" />
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
