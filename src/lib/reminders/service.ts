import "server-only";

import { DomainError } from "@/lib/errors";
import type { Expense } from "@/lib/expenses/types";
import { getCurrentMember } from "@/lib/family/current-member";
import { FORBIDDEN_MESSAGE } from "@/lib/http/permission";
import { can } from "@/lib/permissions";
import {
  occurrenceAlreadyDoneError,
  type ReminderCompletion,
  type ReminderDates,
  type ReminderSummary,
} from "@/lib/reminders/repository";
import { dueAt, nextNotifyAt, nextOccurrenceAfter, snoozeEnd, stateOf } from "@/lib/reminders/schedule";
import { DEFAULT_REMINDER_TIMEZONE, type Reminder, type ReminderState } from "@/lib/reminders/types";
import { getRepositories } from "@/lib/repositories";
import { expenseSchema } from "@/lib/validation/expense";
import type { CompleteReminderInput, ReminderInput, SnoozeInput } from "@/lib/validation/reminder";

// Use cases shared by the REST routes and the MCP tools; each transport only reshapes the result.
// Every write works out the stored dates (next_due_on, next_due_at, snoozed_until, next_notify_at)
// with schedule.ts here, so no caller ever writes them itself. `now` is a parameter for tests.

/** How far back the Done tab reaches by default. */
export const DONE_WINDOW_DAYS = 30;

export const REMINDER_NOT_FOUND_MESSAGE = "Reminder not found.";
export const REMINDER_DONE_MESSAGE = "This reminder is already done.";
export const NO_EXPENSE_TEMPLATE_MESSAGE = "This reminder has no expense to log. Edit it to add one.";
export const EXPENSE_NOT_LOGGED_MESSAGE =
  "This reminder was already marked done somewhere else, so no expense was added. The list is up to date now.";
export const EXPENSE_KEPT_MESSAGE =
  "The expense was added, but the reminder could not be marked done. Check Expenses before trying again, so it isn't added twice.";

/** The 422 for a template saved in another currency than the account's (expenses are in the account's). */
export function templateCurrencyMessage(templateCurrency: string, accountCurrency: string) {
  return `This reminder's expense is in ${templateCurrency}, but your expenses are in ${accountCurrency}. Edit the reminder's expense and try again.`;
}

/** A reminder with where it stands at the moment it was read. */
export type ReminderWithState = Reminder & { state: ReminderState };

export type ReminderOverview = {
  reminders: ReminderWithState[];
  completions: ReminderCompletion[];
};

/** The default `doneSince`: `DONE_WINDOW_DAYS` before `now`, as an ISO timestamp. */
export function defaultDoneSince(now: Date = new Date()): string {
  return new Date(now.getTime() - DONE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function withState(reminder: Reminder, now: Date): ReminderWithState {
  return { ...reminder, state: stateOf(reminder, now) };
}

function notFound(): DomainError {
  return new DomainError(REMINDER_NOT_FOUND_MESSAGE, 404);
}

/**
 * The stored dates for a reminder whose open occurrence is `nextDueOn` (null: a one-off that's
 * done), with `snoozedUntil` kept, as of `now`.
 */
function datesFor(
  reminder: ReminderInput & Pick<Reminder, "timezone">,
  nextDueOn: string | null,
  snoozedUntil: string | null,
  now: Date,
): ReminderDates {
  const schedule = { ...reminder, nextDueOn, snoozedUntil };
  return {
    nextDueOn,
    nextDueAt: nextDueOn === null ? null : dueAt(reminder, nextDueOn).toISOString(),
    snoozedUntil,
    nextNotifyAt: nextNotifyAt(schedule, now)?.toISOString() ?? null,
  };
}

/** The caller's reminders with their state at `now`, and the completions since `doneSince`. */
export async function listReminders(
  doneSince: string = defaultDoneSince(),
  now: Date = new Date(),
): Promise<ReminderOverview> {
  const { reminders, completions } = await getRepositories().reminders.list({ doneSince });
  return { reminders: reminders.map((reminder) => withState(reminder, now)), completions };
}

/** The caller's reminder; a 404 `DomainError` when they have no such reminder. */
export async function getReminder(id: string, now: Date = new Date()): Promise<ReminderWithState> {
  const reminder = await getRepositories().reminders.get(id);
  if (!reminder) throw notFound();
  return withState(reminder, now);
}

/** Adds a reminder for `userId` (the authenticated caller). Its first date is the open occurrence. */
export async function createReminder(
  userId: string,
  input: ReminderInput,
  now: Date = new Date(),
): Promise<ReminderWithState> {
  const values = { ...input, timezone: DEFAULT_REMINDER_TIMEZONE };
  const created = await getRepositories().reminders.create(userId, {
    ...values,
    ...datesFor(values, input.startsOn, null, now),
  });
  return withState(created, now);
}

/**
 * Replaces the reminder's fields and works its dates out again. The open occurrence becomes the
 * first occurrence of the new schedule after the latest one marked done (the first date when none
 * is), so moving the first date back or forward never skips an occurrence or repeats a done one;
 * a one-off that's done reopens only when its date moves past the done one. A snooze is kept while
 * the open occurrence stays the same, and dropped otherwise. A 404 when the caller has no such reminder.
 */
export async function updateReminder(
  id: string,
  input: ReminderInput,
  now: Date = new Date(),
): Promise<ReminderWithState> {
  const { reminders } = getRepositories();
  const [current, lastDone] = await Promise.all([reminders.get(id), reminders.lastCompletedOn(id)]);
  if (!current) throw notFound();

  const values = { ...input, timezone: current.timezone };
  const nextDueOn = lastDone === null ? input.startsOn : nextOccurrenceAfter(values, lastDone);
  const snoozedUntil = nextDueOn === current.nextDueOn ? current.snoozedUntil : null;
  const updated = await reminders.update(id, { ...values, ...datesFor(values, nextDueOn, snoozedUntil, now) });
  // Deleted between the read and the write.
  if (!updated) throw notFound();
  return withState(updated, now);
}

/** Deletes the reminder and its completions; a 404 when the caller has no such reminder. */
export async function deleteReminder(id: string): Promise<void> {
  if (!(await getRepositories().reminders.delete(id))) throw notFound();
}

/**
 * Marks the open occurrence done: records it, moves a repeating reminder to its next occurrence
 * (a one-off to done, with no dates) and clears the snooze. A 404 when the caller has no such
 * reminder, and a 409 when it's a one-off already done or another request marked this occurrence
 * done first. Calling it again marks the next occurrence done. With `occurrenceOn` (the open
 * occurrence the caller saw), a reminder that has moved on since gets the 409 and stays as it is.
 */
export async function completeReminder(
  id: string,
  now: Date = new Date(),
  { occurrenceOn }: Pick<CompleteReminderInput, "occurrenceOn"> = {},
): Promise<ReminderWithState> {
  const { reminders } = getRepositories();
  const current = await reminders.get(id);
  if (!current) throw notFound();
  if (current.nextDueOn === null) throw new DomainError(REMINDER_DONE_MESSAGE, 409);
  if (occurrenceOn !== undefined && occurrenceOn !== current.nextDueOn) throw occurrenceAlreadyDoneError();

  const nextDueOn = nextOccurrenceAfter(current, current.nextDueOn);
  const completed = await reminders.complete(id, current.nextDueOn, datesFor(current, nextDueOn, null, now));
  if (!completed) throw notFound();
  return withState(completed, now);
}

/**
 * "Log expense and mark done" (R12): adds the reminder's expense template as an expense of
 * `userId` (the caller) dated on the open occurrence, then marks that occurrence done with the
 * expense linked on its completion. `amount` replaces the template's amount when given.
 *
 * The order keeps a failure from leaving half of it done:
 * 1. Everything that can be checked first is: the caller may edit expenses (403), the reminder is
 *    theirs (404), still open and on `occurrenceOn` when given (409), has a template (422) in the
 *    account's currency (422). A refusal here changes nothing.
 * 2. The expense is added. If that fails, nothing is marked done.
 * 3. The occurrence is marked done with the expense linked, guarded like `completeReminder`. If that
 *    fails (another tab marked it done first: 409), the expense is deleted again, so the caller
 *    never ends up with a duplicate, and the error says no expense was added. Only if that delete
 *    fails too does the error say the expense was kept, so the caller can check Expenses rather
 *    than add it twice.
 */
export async function completeReminderWithExpense(
  userId: string,
  id: string,
  { occurrenceOn, amount }: Pick<CompleteReminderInput, "occurrenceOn" | "amount"> = {},
  now: Date = new Date(),
): Promise<{ reminder: ReminderWithState; expense: Expense }> {
  if (!can(await getCurrentMember(), "expenses", "edit")) throw new DomainError(FORBIDDEN_MESSAGE, 403);

  const { reminders, expenses, account } = getRepositories();
  const current = await reminders.get(id);
  if (!current) throw notFound();
  if (current.nextDueOn === null) throw new DomainError(REMINDER_DONE_MESSAGE, 409);
  if (occurrenceOn !== undefined && occurrenceOn !== current.nextDueOn) {
    throw new DomainError(EXPENSE_NOT_LOGGED_MESSAGE, 409);
  }
  const template = current.expenseTemplate;
  if (!template) throw new DomainError(NO_EXPENSE_TEMPLATE_MESSAGE, 422);
  const currency = await account.getCurrency(userId);
  if (template.currency !== currency) throw new DomainError(templateCurrencyMessage(template.currency, currency), 422);

  const occurrence = current.nextDueOn;
  const input = expenseSchema.parse({
    description: current.title.slice(0, 120),
    amount: amount ?? template.amount,
    category: template.category,
    subtype: template.subtype,
    expenseDate: occurrence,
  });
  const expense = await expenses.create(userId, input);

  try {
    const nextDueOn = nextOccurrenceAfter(current, occurrence);
    const completed = await reminders.complete(id, occurrence, datesFor(current, nextDueOn, null, now), expense.id);
    if (!completed) throw notFound();
    return { reminder: withState(completed, now), expense };
  } catch (error) {
    const removed = await expenses.delete(userId, expense.id).catch(() => false);
    if (!removed) throw new DomainError(EXPENSE_KEPT_MESSAGE, 409);
    if (error instanceof DomainError && error.status === 409) throw new DomainError(EXPENSE_NOT_LOGGED_MESSAGE, 409);
    throw error;
  }
}

/**
 * Snoozes the open occurrence until `snoozeEnd(snooze, now)`: it leaves Overdue until then and
 * notifies again at that time (unless muted). A 404 when the caller has no such reminder, and a
 * 409 for a one-off that's done.
 */
export async function snoozeReminder(
  id: string,
  snooze: SnoozeInput,
  now: Date = new Date(),
): Promise<ReminderWithState> {
  const { reminders } = getRepositories();
  const current = await reminders.get(id);
  if (!current) throw notFound();
  if (current.nextDueOn === null) throw new DomainError(REMINDER_DONE_MESSAGE, 409);

  const snoozedUntil = snoozeEnd(snooze, now, current.timezone).toISOString();
  const nextNotify = nextNotifyAt({ ...current, snoozedUntil }, now);
  const snoozed = await reminders.update(id, { snoozedUntil, nextNotifyAt: nextNotify?.toISOString() ?? null });
  if (!snoozed) throw notFound();
  return withState(snoozed, now);
}

/** The badge counts: the caller's reminders due and overdue at `now`. */
export async function reminderSummary(now: Date = new Date()): Promise<ReminderSummary> {
  return getRepositories().reminders.summary(now);
}
