"use client";

import { Button, Flex, Input, NativeSelect, Stack, Switch, Text, Textarea } from "@chakra-ui/react";
import { Check } from "lucide-react";
import { useId, useState } from "react";
import { useSWRConfig } from "swr";

import { CategoryField, SubtypeField } from "@/components/expenses/expense-category-fields";
import { useReminderApi, type ReminderFields } from "@/components/reminders/reminder-api";
import { ChipMenu } from "@/components/ui/chip-menu";
import { Disclosure } from "@/components/ui/disclosure";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { SheetForm, useSheetSave } from "@/components/ui/save-button";
import { useAccount } from "@/hooks/use-account";
import { REMINDERS_API_KEY, REMINDERS_SUMMARY_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import { addDays, APPLICATION_TIMEZONE, formatShortDate, getBucharestToday } from "@/lib/calendar";
import { subtypeForCategory, type ExpenseCategory, type ExpenseSubtype } from "@/lib/expenses/categories";
import { can } from "@/lib/permissions";
import { repeatLabel, repeatUnitName } from "@/lib/reminders/format";
import { upsertReminder, type ListedReminder } from "@/lib/reminders/list";
import {
  DEFAULT_LEAD_MINUTES,
  DEFAULT_TIME_OF_DAY,
  LEAD_TIME_PRESETS,
  MAX_LEAD_TIMES,
  MAX_REPEAT_INTERVAL,
  MIN_REPEAT_INTERVAL,
  type RepeatUnit,
} from "@/lib/reminders/types";
import { utcToZoned } from "@/lib/time-zone";

/** The optional Expense section as typed; the amount stays text until it's sent. */
export type ExpenseDraft = {
  /** "Log an expense when marked done" is on. */
  enabled: boolean;
  amount: string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
};

/** The category a new reminder's expense starts on: reminders are mostly bills and rent. */
export const DEFAULT_TEMPLATE_CATEGORY: ExpenseCategory = "housing";

/** The form's fields as typed; the interval and the amount stay text until they're sent. */
export type ReminderDraft = {
  title: string;
  notes: string;
  startsOn: string;
  timeOfDay: string;
  repeatUnit: RepeatUnit;
  repeatInterval: string;
  leadMinutes: number[];
  notificationsMuted: boolean;
  expense: ExpenseDraft;
};

const REPEAT_OPTIONS: { value: RepeatUnit; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "week", label: "By week" },
  { value: "month", label: "By month" },
  { value: "year", label: "By year" },
];

/** The form's starting values: the reminder's, or a new one's (today at 09:00, once, at the time). */
export function draftFor(reminder: ListedReminder | undefined, today: string): ReminderDraft {
  if (!reminder) {
    return {
      title: "",
      notes: "",
      startsOn: today,
      timeOfDay: DEFAULT_TIME_OF_DAY,
      repeatUnit: "none",
      repeatInterval: String(MIN_REPEAT_INTERVAL),
      leadMinutes: [...DEFAULT_LEAD_MINUTES],
      notificationsMuted: false,
      expense: { enabled: false, amount: "", category: DEFAULT_TEMPLATE_CATEGORY, subtype: null },
    };
  }
  const template = reminder.expenseTemplate;
  return {
    title: reminder.title,
    notes: reminder.notes,
    startsOn: reminder.startsOn,
    timeOfDay: reminder.timeOfDay.slice(0, 5),
    repeatUnit: reminder.repeatUnit,
    repeatInterval: String(reminder.repeatInterval),
    leadMinutes: [...reminder.leadMinutes],
    notificationsMuted: reminder.notificationsMuted,
    expense: template
      ? { enabled: true, amount: String(template.amount), category: template.category, subtype: template.subtype }
      : { enabled: false, amount: "", category: DEFAULT_TEMPLATE_CATEGORY, subtype: null },
  };
}

/**
 * Every field of the reminder as POST and PATCH take it. PATCH replaces the whole reminder, so
 * nothing is ever left out. Text is trimmed and the lead times sorted; a one-off's interval is 1.
 * The expense template, when on, is in `currency` (the account's: expenses are kept in it), and
 * null when off. The server validates the rest (an interval outside 1–12, or an amount that isn't
 * above zero, comes back as a field error).
 */
export function draftToFields(draft: ReminderDraft, currency: string): ReminderFields {
  const interval = Number(draft.repeatInterval.trim());
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    startsOn: draft.startsOn,
    timeOfDay: draft.timeOfDay,
    repeatUnit: draft.repeatUnit,
    repeatInterval: draft.repeatUnit === "none" ? MIN_REPEAT_INTERVAL : interval,
    leadMinutes: [...draft.leadMinutes].sort((a, b) => a - b),
    notificationsMuted: draft.notificationsMuted,
    expenseTemplate: draft.expense.enabled
      ? {
        amount: Number(draft.expense.amount.trim()) || 0,
        currency,
        category: draft.expense.category,
        subtype: subtypeForCategory(draft.expense.category, draft.expense.subtype),
      }
      : null,
  };
}

/**
 * The optional Expense section: a switch, then the amount in the account's currency and the
 * expense form's category and subtype pickers. Marking the reminder done then offers to log it.
 */
function ExpenseSection({
  draft,
  currency,
  savedCurrency,
  error,
  onChange,
}: {
  draft: ExpenseDraft;
  currency: string;
  /** The currency the stored template is in, when it isn't `currency`. */
  savedCurrency: string | null;
  error?: string;
  onChange: (next: ExpenseDraft) => void;
}) {
  return (
    <Stack gap="3" borderTopWidth="1px" borderColor="border" pt="3" role="group" aria-label="Expense">
      <Switch.Root
        checked={draft.enabled}
        onCheckedChange={(details) => onChange({ ...draft, enabled: details.checked })}
        colorPalette="brand"
        display="flex"
        justifyContent="space-between"
        gap="4"
        width="full"
      >
        <Stack gap="0">
          <Switch.Label textStyle="bodySm" fontWeight="medium">
            Expense{" "}
            <Text as="span" color="fg.muted" fontWeight="normal">(optional)</Text>
          </Switch.Label>
          <Text textStyle="caption">Marking it done offers to log this expense, dated on the day it was due.</Text>
        </Stack>
        <Switch.HiddenInput />
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Root>
      {draft.enabled ? (
        <>
          <FormField
            label={`Amount (${currency})`}
            error={error}
            hint={savedCurrency ? `Saved in ${savedCurrency}; saving changes it to ${currency}, your expenses' currency.` : undefined}
          >
            <Input
              name="expenseAmount"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              placeholder="0.00"
              required
              value={draft.amount}
              onChange={(event) => onChange({ ...draft, amount: event.target.value })}
            />
          </FormField>
          <FormRow>
            <CategoryField
              flex="1"
              value={draft.category}
              onChange={(category) => onChange({ ...draft, category, subtype: subtypeForCategory(category, draft.subtype) })}
            />
            <SubtypeField
              flex="1"
              category={draft.category}
              value={draft.subtype}
              onChange={(subtype) => onChange({ ...draft, subtype })}
            />
          </FormRow>
        </>
      ) : null}
    </Stack>
  );
}

/** `selected` with `minutes` toggled; adding is refused (unchanged) once `MAX_LEAD_TIMES` are on. */
export function toggleLeadTime(selected: readonly number[], minutes: number): number[] {
  if (selected.includes(minutes)) return selected.filter((value) => value !== minutes);
  if (selected.length >= MAX_LEAD_TIMES) return [...selected];
  return [...selected, minutes].sort((a, b) => a - b);
}

function LeadTimeChips({ selected, onChange }: { selected: number[]; onChange: (next: number[]) => void }) {
  const full = selected.length >= MAX_LEAD_TIMES;
  return (
    <Flex gap="2" wrap="wrap">
      {LEAD_TIME_PRESETS.map((preset) => {
        const pressed = selected.includes(preset.minutes);
        return (
          <Button
            key={preset.minutes}
            size="xs"
            variant={pressed ? "solid" : "outline"}
            colorPalette={pressed ? "brand" : undefined}
            aria-pressed={pressed}
            disabled={!pressed && full}
            onClick={() => onChange(toggleLeadTime(selected, preset.minutes))}
          >
            {pressed ? <Check size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> : null}
            {preset.label}
          </Button>
        );
      })}
    </Flex>
  );
}


/** A start the quick-add sheet offers in one tap, as `startsOn` and `timeOfDay`. */
export type TimePreset = { value: string; label: string; startsOn: string; timeOfDay: string };

/**
 * The quick-add starts, in Bucharest time: this evening at 18:00 (until 17:00), tomorrow at 9:00
 * (the default, "Defaults are stated, not asked") and Saturday at 9:00 (the next one after today).
 */
export function reminderTimePresets(now = new Date()): TimePreset[] {
  const { date: today, time } = utcToZoned(now, APPLICATION_TIMEZONE);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const saturday = addDays(today, ((6 - weekday + 7) % 7) || 7);
  return [
    ...(time < "17:00" ? [{ value: "evening", label: "This evening, 18:00", startsOn: today, timeOfDay: "18:00" }] : []),
    { value: "tomorrow", label: "Tomorrow, 9:00", startsOn: addDays(today, 1), timeOfDay: DEFAULT_TIME_OF_DAY },
    { value: "saturday", label: "Saturday, 9:00", startsOn: saturday, timeOfDay: DEFAULT_TIME_OF_DAY },
  ];
}

const PICK_TIME = "pick";
const QUICK_REPEATS: { value: RepeatUnit; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "week", label: "Every week" },
  { value: "month", label: "Every month" },
  { value: "year", label: "Every year" },
];

/**
 * A reminder's fields, the one form for a reminder. In full (its dialog): title, notes, first
 * date and time, repeat with its interval, up to three lead times, mute, and the optional expense.
 * `compact` (the quick-add sheet): the title, the start and repeat as chips with defaults, and the
 * rest behind "More options". `showExpense` offers the expense section (a kid without expenses
 * access gets none); `savedCurrency` is the stored template's currency when it isn't `currency`.
 */
export function ReminderFormFields({
  draft,
  onChange,
  fieldError,
  currency,
  showExpense,
  savedCurrency = null,
  compact = false,
}: {
  draft: ReminderDraft;
  onChange: (draft: ReminderDraft) => void;
  fieldError: (name: string) => string | undefined;
  currency: string;
  showExpense: boolean;
  savedCurrency?: string | null;
  compact?: boolean;
}) {
  const leadLabel = useId();
  const [pickingTime, setPickingTime] = useState(false);
  const interval = Number(draft.repeatInterval);
  const set = (changes: Partial<ReminderDraft>) => onChange({ ...draft, ...changes });

  const title = (
    <FormField label="Title" labelHidden={compact} error={fieldError("title")}>
      <Input
        name="title"
        size={compact ? "md" : undefined}
        value={draft.title}
        maxLength={200}
        required
        autoFocus={compact}
        placeholder={compact ? "Remind me to…" : "Pay the rent"}
        onChange={(event) => set({ title: event.target.value })}
      />
    </FormField>
  );
  const notes = (
    <FormField label="Notes" optional error={fieldError("notes")}>
      <Textarea
        name="notes"
        value={draft.notes}
        maxLength={2000}
        rows={compact ? 2 : 3}
        resize="vertical"
        placeholder="Add details"
        onChange={(event) => set({ notes: event.target.value })}
      />
    </FormField>
  );
  const dateAndTime = (
    <FormRow>
      <FormField flex="1" label="First date" error={fieldError("startsOn")}>
        <Input name="startsOn" type="date" value={draft.startsOn} required onChange={(event) => set({ startsOn: event.target.value })} />
      </FormField>
      <FormField flex="1" label="Time" error={fieldError("timeOfDay")}>
        <Input name="timeOfDay" type="time" step={60} value={draft.timeOfDay} required onChange={(event) => set({ timeOfDay: event.target.value })} />
      </FormField>
    </FormRow>
  );
  const repeat = (
    <FormRow>
      <FormField
        flex="1"
        label="Repeat"
        error={fieldError("repeatUnit")}
        hint={draft.repeatUnit === "none" ? undefined : `${repeatLabel(draft.repeatUnit, Number.isInteger(interval) && interval > 0 ? interval : 1)}, counted from the first date.`}
      >
        <NativeSelect.Root>
          <NativeSelect.Field name="repeatUnit" value={draft.repeatUnit} onChange={(event) => set({ repeatUnit: event.target.value as RepeatUnit })}>
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormField>
      {draft.repeatUnit === "none" ? null : (
        <FormField flex="1" label="Every" error={fieldError("repeatInterval")}>
          <Flex align="center" gap="2">
            <Input
              name="repeatInterval"
              type="number"
              inputMode="numeric"
              min={MIN_REPEAT_INTERVAL}
              max={MAX_REPEAT_INTERVAL}
              step={1}
              required
              width="20"
              value={draft.repeatInterval}
              onChange={(event) => set({ repeatInterval: event.target.value })}
            />
            <Text textStyle="bodySm" color="fg.muted">
              {repeatUnitName(draft.repeatUnit, interval)}
            </Text>
          </Flex>
        </FormField>
      )}
    </FormRow>
  );
  const notify = (
    <FormField
      label={<span id={leadLabel}>Notify me</span>}
      error={fieldError("leadMinutes")}
      hint={`Up to ${MAX_LEAD_TIMES}. ${draft.leadMinutes.length === 0 ? "With none, it only shows here." : ""}`.trim()}
    >
      <div role="group" aria-labelledby={leadLabel}>
        <LeadTimeChips selected={draft.leadMinutes} onChange={(leadMinutes) => set({ leadMinutes })} />
      </div>
    </FormField>
  );
  const mute = (
    <Switch.Root
      checked={draft.notificationsMuted}
      onCheckedChange={(details) => set({ notificationsMuted: details.checked })}
      colorPalette="brand"
      display="flex"
      justifyContent="space-between"
      gap="4"
      width="full"
    >
      <Stack gap="0">
        <Switch.Label textStyle="bodySm" fontWeight="medium">Mute notifications</Switch.Label>
        <Text textStyle="caption">It still shows as due and overdue here.</Text>
      </Stack>
      <Switch.HiddenInput />
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
  const expense = showExpense ? (
    <ExpenseSection
      draft={draft.expense}
      currency={currency}
      savedCurrency={savedCurrency}
      error={fieldError("expenseTemplate")}
      onChange={(next) => set({ expense: next })}
    />
  ) : null;

  if (!compact) {
    return (
      <Stack gap="3">
        {title}
        {notes}
        {dateAndTime}
        {repeat}
        {notify}
        {mute}
        {expense}
      </Stack>
    );
  }

  const presets = reminderTimePresets();
  const preset = presets.find((item) => item.startsOn === draft.startsOn && item.timeOfDay === draft.timeOfDay);
  const whenLabel = preset?.label ?? `${formatShortDate(draft.startsOn)}, ${draft.timeOfDay}`;
  const repeatChoice = QUICK_REPEATS.find((item) => item.value === draft.repeatUnit && (item.value === "none" || interval === 1));
  return (
    <Stack gap="3">
      {title}
      <Flex gap="2" wrap="wrap">
        <ChipMenu
          aria-label={`When: ${whenLabel}`}
          label={whenLabel}
          items={[...presets, { value: PICK_TIME, label: "Pick a date and time…" }]}
          onSelect={(value) => {
            const chosen = presets.find((item) => item.value === value);
            setPickingTime(!chosen);
            if (chosen) set({ startsOn: chosen.startsOn, timeOfDay: chosen.timeOfDay });
          }}
        />
        <ChipMenu
          aria-label={`Repeat: ${repeatChoice?.label ?? repeatLabel(draft.repeatUnit, interval)}`}
          label={repeatChoice?.label ?? repeatLabel(draft.repeatUnit, interval)}
          selected={draft.repeatUnit !== "none"}
          items={QUICK_REPEATS}
          onSelect={(value) => set({ repeatUnit: value as RepeatUnit, repeatInterval: String(MIN_REPEAT_INTERVAL) })}
        />
      </Flex>
      {pickingTime || fieldError("startsOn") || fieldError("timeOfDay") ? dateAndTime : null}
      <Disclosure label="More options">
        {notes}
        {notify}
        {mute}
        {expense}
      </Disclosure>
    </Stack>
  );
}

/** Whether the caller gets the expense section: kids without expenses access don't, unless one is already saved. */
export function useShowsExpenseSection(draft: ReminderDraft) {
  const { account } = useAccount();
  return can(account?.membership ?? null, "expenses", "edit") || draft.expense.enabled;
}

/**
 * A new reminder from the quick-add sheet: `ReminderFormFields` in compact mode, starting tomorrow
 * at 9:00. It joins the cached list at once, and the due badge refreshes.
 */
export function NewReminderForm({ onSaved }: { onSaved: (reminder: ListedReminder, another: boolean) => void }) {
  const api = useReminderApi();
  const { mutate } = useSWRConfig();
  const { currency } = useAccount();
  const { form, saved, save: run } = useSheetSave();
  const [draft, setDraft] = useState<ReminderDraft>(() => draftFor(undefined, addDays(getBucharestToday(), 1)));
  const showExpense = useShowsExpenseSection(draft);

  function save(another: boolean) {
    run(another, async () => {
      const reminder = await api.create(draftToFields(draft, currency));
      await mutate(REMINDERS_API_KEY, (current?: RemindersResponse) => current && { ...current, reminders: upsertReminder(current.reminders, reminder) }, { revalidate: false });
      void mutate(REMINDERS_SUMMARY_API_KEY);
      return reminder;
    }, (reminder, cleared) => {
      if (cleared) setDraft({ ...draft, title: "", notes: "" });
      onSaved(reminder, cleared);
    });
  }

  return (
    <SheetForm label="Save reminder" form={form} saved={saved} onSave={save}>
      <ReminderFormFields compact draft={draft} onChange={setDraft} fieldError={form.fieldError} currency={currency} showExpense={showExpense} />
    </SheetForm>
  );
}
