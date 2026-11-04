"use client";

import { useCallback, useState, type ReactNode } from "react";

import { LogExpenseDialog } from "@/components/reminders/log-expense-dialog";
import type { SnoozeChoice } from "@/components/reminders/reminder-row";
import { SnoozeDialog } from "@/components/reminders/snooze-dialog";
import type { RemindersState } from "@/components/reminders/use-reminders";
import { useAccount } from "@/hooks/use-account";
import type { ListedReminder } from "@/lib/reminders/list";

/**
 * What tapping Mark done and Snooze does on a reminder row, shared by the Reminders page and Home:
 * the writes from `useReminders` (optimistic, rolled back on a refusal), a row's actions disabled
 * while its write is in flight, and the two dialogs a choice can lead to: the expense confirm for a
 * reminder with an expense template (R12), and "Snooze until…". Render `dialogs` once beside the rows.
 * `onDone` hears what a write that worked did ("Marked done"), for a toast.
 */
export function useReminderActions(reminders: RemindersState, now: Date, onDone?: (message: string) => void) {
  const { currency } = useAccount();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [loggingId, setLoggingId] = useState<string | null>(null);

  /** Runs a mark done or snooze, keeping that row's actions disabled until it settles. */
  const track = useCallback(async (id: string, write: () => Promise<boolean>, message: string) => {
    setBusy((current) => new Set(current).add(id));
    try {
      if (await write()) onDone?.(message);
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [onDone]);

  const markDone = (reminder: ListedReminder) => void track(reminder.id, () => reminders.complete(reminder.id), "Marked done");
  // A reminder with an expense template asks first whether to log it (R12).
  const complete = (reminder: ListedReminder) => {
    if (reminder.expenseTemplate && reminder.nextDueOn) setLoggingId(reminder.id);
    else markDone(reminder);
  };
  const snooze = (reminder: ListedReminder, choice: SnoozeChoice) => {
    if (choice === "until") setSnoozingId(reminder.id);
    else void track(reminder.id, () => reminders.snooze(reminder.id, { kind: choice }), "Snoozed");
  };

  const find = (id: string | null) => (id ? reminders.reminders?.find((reminder) => reminder.id === id) : undefined);
  const logging = find(loggingId);
  const snoozing = find(snoozingId);

  const dialogs: ReactNode = (
    <>
      {logging?.expenseTemplate && logging.nextDueOn ? (
        <LogExpenseDialog
          key={`${logging.id}-${logging.nextDueOn}`}
          reminder={logging}
          template={logging.expenseTemplate}
          occurrenceOn={logging.nextDueOn}
          currency={currency}
          now={now}
          open
          onOpenChange={(open) => { if (!open) setLoggingId(null); }}
          onJustDone={() => markDone(logging)}
          onLog={(amount) => {
            const occurrenceOn = logging.nextDueOn ?? "";
            return track(logging.id, async () => {
              await reminders.completeWithExpense(logging.id, { occurrenceOn, amount });
              return true;
            }, "Marked done, expense logged");
          }}
        />
      ) : null}
      {snoozing ? (
        <SnoozeDialog
          key={snoozing.id}
          reminder={snoozing}
          open
          onOpenChange={(open) => { if (!open) setSnoozingId(null); }}
          onSnooze={(until) => void track(snoozing.id, () => reminders.snooze(snoozing.id, { kind: "until", until }), "Snoozed")}
        />
      ) : null}
    </>
  );

  return { busy, complete, snooze, dialogs };
}
