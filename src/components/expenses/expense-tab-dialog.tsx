"use client";

import { Input, Stack } from "@chakra-ui/react";
import { type FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ExpenseTabCategoryFields } from "@/components/expenses/expense-tab-category-fields";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ApiError, apiRequest } from "@/lib/api/client";
import { EXPENSE_TABS_API_KEY, expenseTabApiKey } from "@/lib/api/keys";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { ExpenseTab } from "@/lib/expenses/tabs";

type SavedTabResponse = { tab: ExpenseTab };
type TabsResponse = { tabs: ExpenseTab[] };

export function ExpenseTabDialog({
  open,
  onOpenChange,
  tab,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: ExpenseTab;
  onSaved: (tab: ExpenseTab) => void;
}) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(tab?.name ?? "");
  const [categories, setCategories] = useState<ExpenseCategory[]>(tab?.categoryKeys ?? []);
  const [subtypes, setSubtypes] = useState<ExpenseSubtype[]>(tab?.subtypeKeys ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const editing = Boolean(tab);

  function toggleCategory(category: ExpenseCategory, checked: boolean) {
    setCategories((current) => checked
      ? [...current, category]
      : current.filter((value) => value !== category));
    if (checked) {
      setSubtypes((current) => current.filter((subtype) => SUBTYPE_CATEGORIES[subtype] !== category));
    }
  }

  function toggleSubtype(subtype: ExpenseSubtype, checked: boolean) {
    setSubtypes((current) => checked
      ? [...current, subtype]
      : current.filter((value) => value !== subtype));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFieldErrors(undefined);
    const payload = {
      name: name.trim(),
      categoryKeys: EXPENSE_CATEGORIES.filter((category) => categories.includes(category)),
      subtypeKeys: EXPENSE_SUBTYPES.filter((subtype) => subtypes.includes(subtype)),
    };
    try {
      const result = await apiRequest<SavedTabResponse>(
        editing ? expenseTabApiKey(tab!.id) : EXPENSE_TABS_API_KEY,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      const saved = result.tab;
      await mutate(
        EXPENSE_TABS_API_KEY,
        (current: TabsResponse | undefined) => {
          const existing = current?.tabs ?? [];
          const tabs = editing
            ? existing.map((item) => item.id === saved.id ? saved : item)
            : [...existing.filter((item) => item.id !== saved.id), saved];
          return { tabs };
        },
        { revalidate: false },
      );
      if (editing) {
        void mutate((key) =>
          typeof key === "string" &&
          key.startsWith(`${expenseTabApiKey(saved.id)}/expenses?`),
        );
      }
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this tab.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit expense tab" : "Create expense tab"}
      description="Choose the categories this tab should include. Your expenses stay in the main ledger."
      footer={
        <FormActions
          form="expense-tab-form"
          closesDialog
          pending={pending}
          submitLabel={editing ? "Save changes" : "Create tab"}
        />
      }
    >
      <form id="expense-tab-form" onSubmit={submit}>
        <Stack gap="4">
          <FormField label="Tab name" error={fieldErrors?.name?.[0]}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="e.g. Car"
              autoFocus
              required
            />
          </FormField>

          <ExpenseTabCategoryFields
            categories={categories}
            subtypes={subtypes}
            onToggleCategory={toggleCategory}
            onToggleSubtype={toggleSubtype}
            error={fieldErrors?.categoryKeys?.[0] ?? fieldErrors?.subtypeKeys?.[0]}
          />

          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      </form>
    </AppDialog>
  );
}
