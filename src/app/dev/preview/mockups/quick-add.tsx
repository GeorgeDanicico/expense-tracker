"use client";

import { Button, Flex, Input, Stack, Switch, Text, Textarea } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";

import { CATEGORY_ICONS } from "@/components/expenses/category-visual";
import { ActionBar, AmountInput, AppDialog, Disclosure, ICON, SegmentedControl, ToggleChip } from "@/components/ui";
import { CATEGORY_LABELS, EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expenses/categories";

import { useMockState } from "./mock-state";
import { MOCK_MEMBERS, MOCK_SUGGESTIONS } from "./mockup-data";
import type { QuickAddKind } from "./mockups";
import { MOCK_CURRENCY } from "./mockup-data";
import { ChipMenu, ChipRow, SaveButton, useSaveCheck } from "./stand-ins";

const KINDS: { value: QuickAddKind; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "todo", label: "To-do" },
  { value: "reminder", label: "Reminder" },
  { value: "event", label: "Event" },
];

const FORMS: Record<QuickAddKind, () => ReactNode> = {
  expense: ExpenseForm,
  todo: TodoForm,
  reminder: ReminderForm,
  event: EventForm,
};

/** The same sheet from every screen: + on the bottom bar, Add (or N) in the sidebar. */
export function QuickAddSheet() {
  const { quickAdd, lastKind, openQuickAdd, closeQuickAdd } = useMockState();
  const kind = quickAdd ?? lastKind;
  const Form = FORMS[kind];
  return (
    <AppDialog open={quickAdd !== null} onOpenChange={(open) => (open ? openQuickAdd(kind) : closeQuickAdd())} title="Quick add" size="sm">
      <Stack gap="4">
        <SegmentedControl aria-label="What to add" items={KINDS} value={kind} onValueChange={openQuickAdd} fullWidth />
        <Form key={kind} />
      </Stack>
    </AppDialog>
  );
}

/** The save buttons and what a save does: the check, then close (or clear for another). */
function useQuickSave(message: string, onSave: () => (() => void) | void) {
  const { closeQuickAdd, showToast } = useMockState();
  const announce = (undo: (() => void) | void) => showToast({ message, action: undo ? "Undo" : "View", onAction: undo || undefined });
  const { saved, save } = useSaveCheck(() => {
    announce(onSave());
    closeQuickAdd();
  });
  return { saved, save, saveAndNew: () => announce(onSave()) };
}

function SaveRow({ label, saved, save, saveAndNew }: { label: string; saved: boolean; save: () => void; saveAndNew: () => void }) {
  return (
    <ActionBar placement="sheet">
      <Flex gap="2">
        <SaveButton saved={saved} onClick={save}>
          {label}
        </SaveButton>
        <Button variant="outline" size="md" onClick={saveAndNew}>
          Save + new
        </Button>
      </Flex>
    </ActionBar>
  );
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

const CATEGORY_ITEMS = EXPENSE_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }));
const DAY_ITEMS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "pick", label: "Pick a date…" },
];

/** Amount first, a description with your own suggestions, the category guessed, today by default. */
function ExpenseForm() {
  const { addExpense, removeExpense } = useMockState();
  const [amount, setAmount] = useState("12.50");
  const [description, setDescription] = useState("Coff");
  const [category, setCategory] = useState<ExpenseCategory>("entertainment");
  const typed = description.trim().toLowerCase();
  const suggestions = typed ? MOCK_SUGGESTIONS.filter((item) => item.description.toLowerCase().startsWith(typed)) : [];
  const { saved, save, saveAndNew } = useQuickSave("Expense added", () => {
    const id = addExpense({ description: description.trim() || "Coffee", category, amount: Number(amount) || 0 });
    setAmount("");
    setDescription("");
    return () => removeExpense(id);
  });

  return (
    <Stack gap="3" as="form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <AmountInput variant="hero" currency={MOCK_CURRENCY} value={amount} onValueChange={setAmount} autoFocus />
      <Input size="md" aria-label="Description" placeholder="What was it?" value={description} onChange={(event) => setDescription(event.target.value)} />
      {suggestions.length > 0 ? (
        <ChipRow label="Your recent descriptions">
          {suggestions.map((item) => (
            <ToggleChip
              key={item.description}
              pressed={item.description === description}
              onClick={() => {
                setDescription(item.description);
                setCategory(item.category);
              }}
            >
              {item.description} · {CATEGORY_LABELS[item.category]}
            </ToggleChip>
          ))}
        </ChipRow>
      ) : null}
      <Flex gap="2" wrap="wrap" align="center">
        <ChipMenu label={<CategoryLabel category={category} />} items={CATEGORY_ITEMS} onSelect={(value) => setCategory(value as ExpenseCategory)} />
        <ChipMenu label="Today" items={DAY_ITEMS} selected={false} />
      </Flex>
      <Disclosure label="More details">
        <Textarea size="md" rows={2} aria-label="Notes" placeholder="Notes" />
        <Flex gap="2" wrap="wrap">
          <ChipMenu label="Subtype: none" items={[{ value: "none", label: "None" }]} selected={false} />
          <ChipMenu label="Tab: none" items={[{ value: "crete", label: "Holiday in Crete" }, { value: "house", label: "House repairs" }]} selected={false} />
        </Flex>
      </Disclosure>
      <SaveRow label="Save expense" saved={saved} save={save} saveAndNew={saveAndNew} />
    </Stack>
  );
}

const MEMBER_ITEMS = [{ value: "anyone", label: "Anyone" }, ...MOCK_MEMBERS.map((member) => ({ value: member.id, label: member.name }))];

/** A title and Enter. The column, assignee and due date are chips with defaults. */
function TodoForm() {
  const [title, setTitle] = useState("Buy printer ink");
  const { saved, save, saveAndNew } = useQuickSave("To-do added", () => setTitle(""));
  return (
    <Stack gap="3" as="form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Input autoFocus size="md" aria-label="To-do" placeholder="What needs doing?" value={title} onChange={(event) => setTitle(event.target.value)} enterKeyHint="done" />
      <Flex gap="2" wrap="wrap">
        <ChipMenu label="To do" items={[{ value: "todo", label: "To do" }, { value: "doing", label: "Doing" }]} />
        <ChipMenu label="Assign: Mihai" items={MEMBER_ITEMS} />
        <ChipMenu label="No due date" items={[{ value: "today", label: "Today" }, { value: "tomorrow", label: "Tomorrow" }, { value: "pick", label: "Pick a date…" }]} selected={false} />
      </Flex>
      <Text textStyle="caption">Enter adds it. Notes are on the card.</Text>
      <SaveRow label="Add to-do" saved={saved} save={save} saveAndNew={saveAndNew} />
    </Stack>
  );
}

/** A title; tomorrow 9:00 unless you change it; the rest folded away. */
function ReminderForm() {
  const [title, setTitle] = useState("Renew car insurance");
  const { saved, save, saveAndNew } = useQuickSave("Reminder set for tomorrow, 9:00", () => setTitle(""));
  return (
    <Stack gap="3" as="form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Input autoFocus size="md" aria-label="Reminder" placeholder="Remind me to…" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Flex gap="2" wrap="wrap">
        <ChipMenu
          label="Tomorrow, 9:00"
          items={[
            { value: "evening", label: "This evening, 18:00" },
            { value: "tomorrow", label: "Tomorrow, 9:00" },
            { value: "weekend", label: "Saturday, 9:00" },
            { value: "pick", label: "Pick a date and time…" },
          ]}
        />
        <ChipMenu
          label="Doesn't repeat"
          items={["Doesn't repeat", "Every day", "Every week", "Every month", "Every year"].map((label) => ({ value: label, label }))}
          selected={false}
        />
      </Flex>
      <Disclosure label="More options">
        <Textarea size="md" rows={2} aria-label="Notes" placeholder="Notes" />
        <Flex gap="2" wrap="wrap">
          <ChipMenu label="Notify: at the time" items={[{ value: "0", label: "At the time" }, { value: "15", label: "15 minutes before" }, { value: "60", label: "An hour before" }]} selected={false} />
        </Flex>
        <QuietSwitch label="Log an expense when it's done" />
      </Disclosure>
      <SaveRow label="Save reminder" saved={saved} save={save} saveAndNew={saveAndNew} />
    </Stack>
  );
}

/** A title and the day; who's going defaults to everyone. Only offered with a family. */
function EventForm() {
  const [title, setTitle] = useState("Grandma's birthday");
  const { saved, save, saveAndNew } = useQuickSave("Event added to Saturday", () => setTitle(""));
  return (
    <Stack gap="3" as="form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <Input autoFocus size="md" aria-label="Event" placeholder="What's happening?" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Flex gap="2" wrap="wrap">
        <ChipMenu
          label="Sat 7 Nov"
          items={[
            { value: "today", label: "Today" },
            { value: "tomorrow", label: "Tomorrow" },
            { value: "sat", label: "Saturday 7" },
            { value: "pick", label: "Pick a date…" },
          ]}
        />
        <ChipMenu label="All day" items={[{ value: "all", label: "All day" }, { value: "time", label: "Choose a time…" }]} />
        <ChipMenu label="Everyone" items={[{ value: "everyone", label: "Everyone" }, ...MOCK_MEMBERS.map((member) => ({ value: member.id, label: member.name }))]} />
      </Flex>
      <Disclosure label="More options">
        <Input size="md" aria-label="Where" placeholder="Where" />
        <Textarea size="md" rows={2} aria-label="Notes" placeholder="Notes" />
        <Flex gap="2" wrap="wrap">
          <ChipMenu label="Doesn't repeat" items={["Doesn't repeat", "Every week", "Every year"].map((label) => ({ value: label, label }))} selected={false} />
        </Flex>
      </Disclosure>
      <SaveRow label="Add event" saved={saved} save={save} saveAndNew={saveAndNew} />
    </Stack>
  );
}

function QuietSwitch({ label }: { label: string }) {
  return (
    <Switch.Root size="md">
      <Switch.HiddenInput />
      <Switch.Control />
      <Switch.Label textStyle="body">{label}</Switch.Label>
    </Switch.Root>
  );
}
