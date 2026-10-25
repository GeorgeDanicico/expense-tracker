"use client";

import { NativeSelect } from "@chakra-ui/react";

import { FormField } from "@/components/ui/form-field";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  SUBTYPE_LABELS,
  subtypesForCategory,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";

/**
 * The expense category picker, shared by the add-expense form and a reminder's expense template.
 * Pair it with `SubtypeField`, and keep the subtype with `subtypeForCategory` when this changes.
 */
export function CategoryField({
  value,
  onChange,
  error,
  flex,
}: {
  value: ExpenseCategory;
  onChange: (category: ExpenseCategory) => void;
  error?: string;
  flex?: string;
}) {
  return (
    <FormField flex={flex} label="Category" error={error}>
      <NativeSelect.Root>
        <NativeSelect.Field name="category" value={value} onChange={(event) => onChange(event.target.value as ExpenseCategory)}>
          {EXPENSE_CATEGORIES.map((category) => (
            <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );
}

/** The optional subtype of `category`; renders nothing for a category without subtypes. */
export function SubtypeField({
  category,
  value,
  onChange,
  error,
  flex,
}: {
  category: ExpenseCategory;
  value: ExpenseSubtype | null;
  onChange: (subtype: ExpenseSubtype | null) => void;
  error?: string;
  flex?: string;
}) {
  const options = subtypesForCategory(category);
  if (options.length === 0) return null;
  return (
    <FormField flex={flex} label="Subtype" optional error={error}>
      <NativeSelect.Root>
        <NativeSelect.Field
          name="subtype"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value ? event.target.value as ExpenseSubtype : null)}
        >
          <option value="">No subtype</option>
          {options.map((option) => <option key={option} value={option}>{SUBTYPE_LABELS[option]}</option>)}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );
}
