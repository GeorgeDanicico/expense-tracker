"use client";

import { Stack } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { NewEventForm } from "@/components/family-calendar/event-form";
import { useNavigation } from "@/components/layout/use-navigation";
import { NewReminderForm } from "@/components/reminders/reminder-form";
import { NewTodoForm } from "@/components/todos/todo-form";
import { AppDialog } from "@/components/ui/app-dialog";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { UndoToast, UNDO_MS } from "@/components/ui/undo-toast";
import { useAccount } from "@/hooks/use-account";
import { CALENDAR_EVENT_PARAM } from "@/lib/family-calendar/linked-event";
import { formatDueAt } from "@/lib/reminders/format";
import { TODO_CARD_PARAM } from "@/lib/todos/filters";

import { initialKind, isQuickAddShortcut, quickAddKindsFor, readLastKind, rememberKind, type QuickAddKind } from "./kinds";

export type QuickAddOptions = {
  /** The form to open on; the last one used on this device otherwise. */
  kind?: QuickAddKind;
  /** The new expense's date, from a screen showing another month; today otherwise. */
  expenseDate?: string;
};

type QuickAddState = { kind: QuickAddKind; expenseDate?: string };
/** What a save says, and where its View goes. */
type Saved = { message: string; href: string };

const QuickAddContext = createContext<{ open: (options?: QuickAddOptions) => void }>({ open: () => undefined });

/** Opens the quick-add sheet: the + in the bottom bar, Add at the top of the sidebar, N on desktop. */
export function useQuickAdd() {
  return useContext(QuickAddContext);
}

/**
 * The one quick-add sheet, the same on every screen ("How the app becomes mobile first", point 2):
 * Expense, To-do, Reminder and Event, each the module's own form in its compact mode, offered as
 * the user's navigation allows (Event and To-do only with a family). It remembers the last kind
 * used per device. A save closes it (or clears it for "Save and add another") and a toast says
 * what was added, with View to go to it.
 */
function QuickAddSheet({
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
        defaultDate={state.expenseDate}
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

/** The sheet, its toast and the N shortcut, for everything inside the app shell. */
export function QuickAddProvider({ initial = null, children }: { initial?: QuickAddOptions | null; children: ReactNode }) {
  const router = useRouter();
  const { sections } = useNavigation();
  const kinds = useMemo(() => quickAddKindsFor(sections), [sections]);
  const offered = useMemo(() => kinds.map((entry) => entry.kind), [kinds]);
  const [isOpen, setOpen] = useState(initial !== null);
  // Kept while the sheet slides away, so its form doesn't change under it.
  const [asked, setAsked] = useState<QuickAddOptions>(initial ?? {});
  const [toast, setToast] = useState<Saved | null>(null);
  const state: QuickAddState = { kind: initialKind(offered, asked.kind), expenseDate: asked.expenseDate };

  const open = useCallback((options: QuickAddOptions = {}) => {
    setAsked({ ...options, kind: initialKind(offered, options.kind, readLastKind()) });
    setOpen(true);
  }, [offered]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isQuickAddShortcut(event, Boolean(document.querySelector("[role=dialog], [role=alertdialog]")))) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ open }), [open]);
  return (
    <QuickAddContext.Provider value={value}>
      {children}
      <QuickAddSheet
        open={isOpen}
        state={state}
        kinds={kinds}
        onKindChange={(kind) => {
          rememberKind(kind);
          setAsked({ kind });
        }}
        onClose={() => setOpen(false)}
        onSaved={(saved, another) => {
          rememberKind(state.kind);
          setToast(saved);
          if (!another) setOpen(false);
        }}
      />
      <UndoToast
        message={toast?.message ?? null}
        actionLabel="View"
        onUndo={toast ? () => {
          setToast(null);
          router.push(toast.href);
        } : undefined}
      />
    </QuickAddContext.Provider>
  );
}
