"use client";

import { Flex, Input, Textarea } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { CATEGORY_ICONS } from "@/components/expenses/category-visual";
import { SubtypeField } from "@/components/expenses/expense-category-fields";
import { useExpenseWrites } from "@/components/expenses/use-expense-writes";
import { AmountInput } from "@/components/ui/amount-input";
import { ChipMenu, ChipRow } from "@/components/ui/chip-menu";
import { Disclosure } from "@/components/ui/disclosure";
import { FormField } from "@/components/ui/form-field";
import { ICON } from "@/components/ui/icon";
import { SheetForm, useSheetSave } from "@/components/ui/save-button";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { ApiError } from "@/lib/api/client";
import { expenseSuggestionsApiKey } from "@/lib/api/keys";
import { addDays, formatShortDate, getBucharestToday } from "@/lib/calendar";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, subtypeForCategory, type ExpenseCategory } from "@/lib/expenses/categories";
import type { Classification, SuggestionsResponse } from "@/lib/expenses/suggestions";
import type { Expense } from "@/lib/expenses/types";
import { expenseSchema } from "@/lib/validation/expense";
import { fieldErrorsOf } from "@/lib/validation/field-errors";

/** The category a new expense starts on until a description says otherwise: the most common one. */
export const DEFAULT_CATEGORY: ExpenseCategory = "groceries";
/** How long typing pauses before the suggestions are asked for. */
const SUGGEST_AFTER_MS = 150;
const PICK_DATE = "pick";

/** `value`, once it has stayed the same for `ms`. */
function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** What a date chip says: Today, Yesterday, or the day ("Nov 2"). */
export function dateChipLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatShortDate(date, date.slice(0, 4) !== today.slice(0, 4));
}

/**
 * The classification the form shows: the one chosen by hand or by picking a suggestion, else the
 * one guessed from the description, else the default.
 */
export function shownClassification(chosen: Classification | null, guess: Classification | null): Classification {
  return chosen ?? guess ?? { category: DEFAULT_CATEGORY, subtype: null };
}

function CategoryLabel({ category }: { category: ExpenseCategory }) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <>
      <Icon size={ICON.xs} aria-hidden="true" />
      {CATEGORY_LABELS[category]}
    </>
  );
}

const CATEGORY_ITEMS = EXPENSE_CATEGORIES.map((category) => ({ value: category, label: <CategoryLabel category={category} /> }));

/**
 * The fast expense form ("How the app becomes mobile first", point 3, in docs/ui-plan.md), the one
 * form for adding an expense, in the quick-add sheet: the amount first (decimal keypad, focused),
 * a description with suggestions from the caller's own expenses (picking one fills its category
 * and subtype), the category guessed from the description as a chip that changes in one tap, today
 * as the date, notes and subtype behind "More details", and Save at the bottom with "Save and add
 * another". Checked with the shared `expenseSchema` before anything is sent, then saved
 * optimistically (`useExpenseWrites`).
 */
export function ExpenseForm({
  currency,
  defaultDate,
  onSaved,
}: {
  currency: string;
  /** The date to start on; today when absent. */
  defaultDate?: string;
  /** After a save: `another` is true when the form has cleared itself for the next expense. */
  onSaved: (expense: Expense, another: boolean) => void;
}) {
  const today = getBucharestToday();
  const { form, saved, save: run } = useSheetSave();
  const { add } = useExpenseWrites();
  const amountRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Classification | null>(null);
  const [expenseDate, setExpenseDate] = useState(defaultDate ?? today);
  const [pickingDate, setPickingDate] = useState(false);
  const [notes, setNotes] = useState("");

  const typed = description.trim();
  const query = useSettled(typed, SUGGEST_AFTER_MS);
  const { data } = useSWR<SuggestionsResponse>(query ? expenseSuggestionsApiKey(query) : null, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });
  const suggestions = typed && description !== picked ? (data?.suggestions ?? []) : [];
  const { category, subtype } = shownClassification(chosen, typed ? (data?.guess ?? null) : null);

  function clear() {
    setAmount("");
    setDescription("");
    setPicked(null);
    setChosen(null);
    setNotes("");
    amountRef.current?.focus();
  }

  function save(another: boolean) {
    run(another, async () => {
      const parsed = expenseSchema.safeParse({ description, amount, category, subtype, expenseDate, notes });
      if (!parsed.success) throw new ApiError("Check the highlighted details and try again.", 422, fieldErrorsOf(parsed.error));
      return add(parsed.data);
    }, (expense, cleared) => {
      if (cleared) clear();
      onSaved(expense, cleared);
    });
  }

  const dateItems = [
    { value: today, label: "Today" },
    { value: addDays(today, -1), label: "Yesterday" },
    { value: PICK_DATE, label: "Pick a date…" },
  ];

  return (
    <SheetForm label="Save expense" form={form} saved={saved} onSave={save}>
      <FormField label={`Amount in ${currency}`} labelHidden error={form.fieldError("amount")}>
        <AmountInput
          ref={amountRef}
          variant="hero"
          name="amount"
          currency={currency}
          value={amount}
          onValueChange={setAmount}
          autoFocus
          aria-invalid={form.fieldError("amount") ? true : undefined}
        />
      </FormField>
      <FormField label="Description" labelHidden error={form.fieldError("description")}>
        <Input
          name="description"
          size="md"
          maxLength={120}
          placeholder="What was it?"
          autoComplete="off"
          enterKeyHint="done"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FormField>
      {suggestions.length > 0 ? (
        <ChipRow label="Your recent descriptions">
          {suggestions.map((suggestion) => (
            <ToggleChip
              key={suggestion.description}
              flexShrink="0"
              onClick={() => {
                setDescription(suggestion.description);
                setPicked(suggestion.description);
                setChosen({ category: suggestion.category, subtype: suggestion.subtype });
              }}
            >
              {suggestion.description} · {CATEGORY_LABELS[suggestion.category]}
            </ToggleChip>
          ))}
        </ChipRow>
      ) : null}
      <Flex gap="2" wrap="wrap" align="center">
        <ChipMenu
          aria-label={`Category: ${CATEGORY_LABELS[category]}`}
          label={<CategoryLabel category={category} />}
          items={CATEGORY_ITEMS}
          onSelect={(value) => {
            const next = value as ExpenseCategory;
            setChosen({ category: next, subtype: subtypeForCategory(next, subtype) });
          }}
        />
        <ChipMenu
          aria-label={`Date: ${dateChipLabel(expenseDate, today)}`}
          label={dateChipLabel(expenseDate, today)}
          selected={expenseDate !== today}
          items={dateItems}
          onSelect={(value) => {
            setPickingDate(value === PICK_DATE);
            if (value !== PICK_DATE) setExpenseDate(value);
          }}
        />
      </Flex>
      {pickingDate || form.fieldError("expenseDate") ? (
        <FormField label="Date" error={form.fieldError("expenseDate")}>
          <Input name="expenseDate" type="date" size="md" value={expenseDate} required onChange={(event) => setExpenseDate(event.target.value)} />
        </FormField>
      ) : null}
      <Disclosure label="More details">
        <FormField label="Notes" labelHidden optional error={form.fieldError("notes")}>
          <Textarea name="notes" size="md" rows={2} maxLength={500} placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </FormField>
        <SubtypeField category={category} value={subtype} onChange={(next) => setChosen({ category, subtype: next })} error={form.fieldError("subtype")} />
      </Disclosure>
    </SheetForm>
  );
}
