import { DomainError } from "@/lib/errors";
import { stateOf } from "@/lib/reminders/schedule";
import type { Reminder, ReminderSchedule } from "@/lib/reminders/types";
import type { ReminderInput } from "@/lib/validation/reminder";

export const OCCURRENCE_ALREADY_DONE_MESSAGE = "This reminder is already marked done. Refresh and try again.";

/** A 409 for marking an occurrence done that's already done (a double click, or another tab). */
export function occurrenceAlreadyDoneError(): DomainError {
  return new DomainError(OCCURRENCE_ALREADY_DONE_MESSAGE, 409);
}

/** One occurrence marked done, for the Done tab. */
export type ReminderCompletion = {
  id: string;
  reminderId: string;
  /** The occurrence's date, `YYYY-MM-DD` in the reminder's time zone. */
  occurrenceOn: string;
  /** When it was marked done (ISO). */
  doneAt: string;
  /** The expense logged for it (R12), if any. */
  expenseId: string | null;
};

/** The caller's reminders, and the occurrences they marked done since `doneSince`. */
export type ReminderList = {
  /** Every reminder of the caller, by `nextDueAt` (one-offs that are done last). */
  reminders: Reminder[];
  /** Newest first. */
  completions: ReminderCompletion[];
};

/** The open occurrence a mark done moves to, worked out by `schedule.ts` (all null after a one-off). */
export type ReminderNextOccurrence = Pick<Reminder, "nextDueOn" | "nextDueAt" | "nextNotifyAt">;

/** The stored dates the service works out with `schedule.ts` on every write; never from the client. */
export type ReminderDates = ReminderNextOccurrence & Pick<Reminder, "snoozedUntil">;

/** Everything a reminder row stores: the form's fields, its time zone and its dates. */
export type ReminderValues = ReminderInput & Pick<Reminder, "timezone"> & ReminderDates;

/** Badge counts at a moment: reminders due today (before their time) and overdue ones; snoozed ones count as neither. */
export type ReminderSummary = { due: number; overdue: number };

/** Counts `reminders` by their state at `now`, for `ReminderRepository.summary`. */
export function summarizeReminders(
  reminders: readonly Pick<ReminderSchedule, "timeOfDay" | "timezone" | "nextDueOn" | "snoozedUntil">[],
  now: Date,
): ReminderSummary {
  const summary: ReminderSummary = { due: 0, overdue: 0 };
  for (const reminder of reminders) {
    const state = stateOf(reminder, now);
    if (state === "due" || state === "overdue") summary[state] += 1;
  }
  return summary;
}

/**
 * The caller's private reminders. Get it from `getRepositories()`; never import an implementation.
 * Methods act as the signed-in caller (RLS: owner only, parents included); another user's reminder
 * counts as missing. Writes store what they're given: the dates come from `src/lib/reminders/service.ts`,
 * which runs `schedule.ts`, so routes and MCP tools go through the service rather than writing here.
 */
export interface ReminderRepository {
  /** Every reminder of the caller, and their completions done at or after `doneSince` (ISO). */
  list(options: { doneSince: string }): Promise<ReminderList>;
  /** The reminder, or null when the caller has no such reminder. */
  get(id: string): Promise<Reminder | null>;
  /**
   * The latest occurrence of the reminder marked done, or null when none is (or no such reminder).
   * Editing a reminder places its open occurrence after this one.
   */
  lastCompletedOn(id: string): Promise<string | null>;
  /** Adds a reminder owned by `userId` (the authenticated caller; RLS refuses anyone else). */
  create(userId: string, values: ReminderValues): Promise<Reminder>;
  /** Changes the given fields. Returns null when the caller has no such reminder. */
  update(id: string, values: Partial<ReminderValues>): Promise<Reminder | null>;
  /** Deletes the reminder and its completions, returning false when the caller has no such reminder. */
  delete(id: string): Promise<boolean>;
  /**
   * Marks the open occurrence `occurrenceOn` done: moves the reminder to `next` and clears its
   * snooze, but only while `occurrenceOn` is still its open occurrence, then records the completion.
   * Returns the moved reminder, or null when the caller has no such reminder. Throws a 409
   * `DomainError` (`occurrenceAlreadyDoneError`) when the open occurrence is no longer
   * `occurrenceOn`: another request marked it done first. `expenseId` (R12) links the caller's
   * expense logged for the occurrence on its completion.
   */
  complete(id: string, occurrenceOn: string, next: ReminderNextOccurrence, expenseId?: string | null): Promise<Reminder | null>;
  /** How many of the caller's reminders are due and overdue at `now` (`stateOf`). */
  summary(now: Date): Promise<ReminderSummary>;
}
