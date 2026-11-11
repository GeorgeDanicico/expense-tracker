"use client";

import { Stack } from "@chakra-ui/react";
import { Fragment, useRef, type ReactNode } from "react";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { NewEventForm } from "@/components/family-calendar/event-form";
import { NewReminderForm } from "@/components/reminders/reminder-form";
import { NewTodoForm } from "@/components/todos/todo-form";
import { AppDialog } from "@/components/ui/app-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAccount } from "@/hooks/use-account";
import { CALENDAR_EVENT_PARAM } from "@/lib/family-calendar/linked-event";
import { formatDueAt } from "@/lib/reminders/format";
import { TODO_CARD_PARAM } from "@/lib/todos/filters";

import type { QuickAddKind } from "./kinds";

export type QuickAddState = { kind: QuickAddKind };
/** What a save says, and where its View goes. */
export type Saved = { message: string; href: string };

/**
 * The one quick-add sheet, the same on every screen ("How the app becomes mobile first", point 2):
 * Expense, To-do, Reminder and Event, each the module's own form in its compact mode, offered as
 * the user's navigation allows (Event and To-do only with a family). It remembers the last kind
 * used per device. A save closes it (or clears it for "Save and add another") and a toast says
 * what was added, with View to go to it.
 *
 * This file holds the four forms and everything they pull in (Zod, the date and amount fields), so
 * the provider loads it on demand and ahead of the first tap (PF9).
 */
export function QuickAddSheet({
  open,
  state,
  kinds,
  onKindChange,
  onClose,
  onSaved,
}: {
  open: boolean;
  state: QuickAddState;
  kinds: readonly { kind: QuickAddKind; label: string }[];
  onKindChange: (kind: QuickAddKind) => void;
  onClose: () => void;
  onSaved: (saved: Saved, another: boolean) => void;
}) {
  const { currency } = useAccount();
  const content = useRef<HTMLDivElement | null>(null);
  const forms: Record<QuickAddKind, ReactNode> = {
    expense: (
      <ExpenseForm
        currency={currency}
        onSaved={(expense, another) => onSaved({ message: "Expense added", href: `/expenses?month=${expense.expenseDate.slice(0, 7)}` }, another)}
      />
    ),
    todo: <NewTodoForm onSaved={(todo, another) => onSaved({ message: "To-do added", href: `/todos?${TODO_CARD_PARAM}=${todo.id}` }, another)} />,
    reminder: (
      <NewReminderForm
        onSaved={(reminder, another) => {
          const due = formatDueAt(reminder);
          onSaved({ message: due ? `Reminder set for ${due}` : "Reminder added", href: "/reminders" }, another);
        }}
      />
    ),
    event: (
      <NewEventForm
        onSaved={(events, another) => onSaved({ message: "Event added", href: events[0] ? `/calendar?${CALENDAR_EVENT_PARAM}=${events[0].id}` : "/calendar" }, another)}
      />
    ),
  };
  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Quick add"
      size="sm"
      closeLabel="Close quick add"
      contentRef={content}
      // The form's first field (the amount for an expense), not the kind switch above it.
      initialFocusEl={() => content.current?.querySelector<HTMLElement>("form :is(input:not([type=radio]), textarea)") ?? null}
    >
      <Stack gap="4">
        {kinds.length > 1 ? (
          <SegmentedControl
            aria-label="What to add"
            items={kinds.map(({ kind, label }) => ({ value: kind, label }))}
            value={state.kind}
            onValueChange={onKindChange}
            fullWidth
          />
        ) : null}
        <Fragment key={state.kind}>{forms[state.kind]}</Fragment>
      </Stack>
    </AppDialog>
  );
}
