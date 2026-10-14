"use client";

import { Flex, Input, NativeSelect, Stack, Textarea } from "@chakra-ui/react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { ApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterExpenseCreated } from "@/lib/api/invalidate";
import {
  SUBTYPE_LABELS,
  subtypesForCategory,
  subtypeForCategory,
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { getMonthRange } from "@/lib/calendar";

/** Add-expense form body. Submits to `/api/expenses` and updates the SWR caches. */
export function ExpenseForm({
  id,
  selectedMonth,
  currency,
  form,
  onSuccess,
}: {
  id: string;
  selectedMonth: string;
  currency: string;
  /** Owned by the dialog so its submit button can show the pending state. */
  form: ApiForm;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [category, setCategory] = useState<ExpenseCategory>("groceries");
  const [subtype, setSubtype] = useState<ExpenseSubtype | null>(null);
  const availableSubtypes = subtypesForCategory(category);
  const range = getMonthRange(selectedMonth);
  const endDate = new Date(`${range.endExclusive}T12:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const maxDate = endDate.toISOString().slice(0, 10);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    void form.submit(async () => {
      const { expense } = await apiRequest<{ expense: Expense }>("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          selectedMonth,
          description: formData.get("description"),
          amount: formData.get("amount"),
          category: formData.get("category"),
          subtype,
          expenseDate: formData.get("expenseDate"),
          notes: formData.get("notes"),
        }),
      });

      await afterExpenseCreated(mutate, selectedMonth, expense);
      onSuccess();
    }, { fallback: "The expense could not be saved." });
  }

  const { fieldError } = form;

  return (
    <form id={id} onSubmit={submit}>
      <Stack gap="3">
        <FormField label="Description" error={fieldError("description")}>
          <Input name="description" maxLength={120} placeholder="e.g. Weekly groceries" autoFocus required />
        </FormField>

        <FormField label={`Amount (${currency})`} error={fieldError("amount")}>
          <Input name="amount" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" required />
        </FormField>

        <Flex gap="3" direction={{ base: "column", sm: "row" }}>
          <FormField flex="1" label="Category" error={fieldError("category")}>
            <NativeSelect.Root>
              <NativeSelect.Field name="category" value={category} onChange={(event) => {
                const nextCategory = event.target.value as ExpenseCategory;
                setCategory(nextCategory);
                setSubtype((current) => subtypeForCategory(nextCategory, current));
              }}>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>

          <FormField flex="1" label="Date" error={fieldError("expenseDate")}>
            <Input
              name="expenseDate"
              type="date"
              defaultValue={maxDate}
              min={range.start}
              max={maxDate}
              required
            />
          </FormField>
        </Flex>

        {availableSubtypes.length ? (
          <FormField label="Subtype" optional error={fieldError("subtype")}>
            <NativeSelect.Root>
              <NativeSelect.Field name="subtype" value={subtype ?? ""} onChange={(event) => setSubtype(event.target.value ? event.target.value as ExpenseSubtype : null)}>
                <option value="">No subtype</option>
                {availableSubtypes.map((option) => <option key={option} value={option}>{SUBTYPE_LABELS[option]}</option>)}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>
        ) : null}

        <FormField label="Notes" optional error={fieldError("notes")}>
          <Textarea name="notes" maxLength={500} rows={3} placeholder="Add an optional note" resize="vertical" />
        </FormField>

        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
      </Stack>
    </form>
  );
}
