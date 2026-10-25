import "server-only";

import type { Database } from "@/lib/database.types";
import {
  occurrenceAlreadyDoneError,
  summarizeReminders,
  type ReminderCompletion,
  type ReminderRepository,
  type ReminderValues,
} from "@/lib/reminders/repository";
import { REPEAT_UNITS, type ExpenseTemplate, type Reminder, type RepeatUnit } from "@/lib/reminders/types";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { expenseTemplateSchema } from "@/lib/validation/reminder";

const LOAD_ERROR = "Unable to load your reminders.";
const SAVE_ERROR = "Unable to save the reminder.";
const DELETE_ERROR = "Unable to delete the reminder.";
const COMPLETE_ERROR = "Unable to mark the reminder done.";

const REMINDER_COLUMNS =
  "id, title, notes, starts_on, time_of_day, timezone, repeat_unit, repeat_interval, lead_minutes, notifications_muted, next_due_on, next_due_at, snoozed_until, next_notify_at, expense_template, created_at, updated_at";
const COMPLETION_COLUMNS = "id, reminder_id, occurrence_on, done_at, expense_id";

type ReminderRow = Pick<
  Database["public"]["Tables"]["reminders"]["Row"],
  | "id" | "title" | "notes" | "starts_on" | "time_of_day" | "timezone" | "repeat_unit" | "repeat_interval"
  | "lead_minutes" | "notifications_muted" | "next_due_on" | "next_due_at" | "snoozed_until"
  | "next_notify_at" | "expense_template" | "created_at" | "updated_at"
>;
type CompletionRow = Database["public"]["Tables"]["reminder_completions"]["Row"];
type ReminderWrite = Database["public"]["Tables"]["reminders"]["Update"];

function toRepeatUnit(value: string): RepeatUnit {
  if ((REPEAT_UNITS as readonly string[]).includes(value)) return value as RepeatUnit;
  throw new Error(LOAD_ERROR);
}

/** PostgREST answers instants as `+00:00` strings; the API speaks `Z` ISO strings. */
function toIso(value: string): string;
function toIso(value: string | null): string | null;
function toIso(value: string | null) {
  return value === null ? null : new Date(value).toISOString();
}

/** The stored template, or null for none; one that no longer validates (a removed category) counts as none. */
function toExpenseTemplate(value: ReminderRow["expense_template"]): ExpenseTemplate | null {
  if (value === null) return null;
  const parsed = expenseTemplateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    startsOn: row.starts_on,
    // A `time` column comes back as `HH:MM:SS`.
    timeOfDay: row.time_of_day.slice(0, 5),
    timezone: row.timezone,
    repeatUnit: toRepeatUnit(row.repeat_unit),
    repeatInterval: row.repeat_interval,
    leadMinutes: row.lead_minutes,
    notificationsMuted: row.notifications_muted,
    nextDueOn: row.next_due_on,
    nextDueAt: toIso(row.next_due_at),
    snoozedUntil: toIso(row.snoozed_until),
    nextNotifyAt: toIso(row.next_notify_at),
    expenseTemplate: toExpenseTemplate(row.expense_template),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toCompletion(row: CompletionRow): ReminderCompletion {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    occurrenceOn: row.occurrence_on,
    doneAt: toIso(row.done_at),
    expenseId: row.expense_id,
  };
}

/** The given fields as columns; absent fields stay as they are. */
function columns(values: Partial<ReminderValues>): ReminderWrite {
  const entries: [keyof ReminderValues, keyof ReminderWrite][] = [
    ["title", "title"],
    ["notes", "notes"],
    ["startsOn", "starts_on"],
    ["timeOfDay", "time_of_day"],
    ["timezone", "timezone"],
    ["repeatUnit", "repeat_unit"],
    ["repeatInterval", "repeat_interval"],
    ["leadMinutes", "lead_minutes"],
    ["notificationsMuted", "notifications_muted"],
    ["nextDueOn", "next_due_on"],
    ["nextDueAt", "next_due_at"],
    ["snoozedUntil", "snoozed_until"],
    ["nextNotifyAt", "next_notify_at"],
    ["expenseTemplate", "expense_template"],
  ];
  return Object.fromEntries(
    entries.filter(([field]) => values[field] !== undefined).map(([field, column]) => [column, values[field]]),
  ) as ReminderWrite;
}

/**
 * `ReminderRepository` on `reminders` and `reminder_completions`, acting as the request's caller.
 * RLS limits every row to the caller's own reminders (and their completions), so queries don't
 * filter by user themselves.
 */
export const supabaseReminderRepository: ReminderRepository = {
  async list({ doneSince }) {
    const supabase = await createClient();
    const [reminders, completions] = await Promise.all([
      supabase.from("reminders").select(REMINDER_COLUMNS).order("next_due_at", { nullsFirst: false }).order("created_at"),
      supabase.from("reminder_completions").select(COMPLETION_COLUMNS).gte("done_at", doneSince)
        .order("done_at", { ascending: false }),
    ]);
    if (reminders.error || completions.error) throw new Error(LOAD_ERROR);
    return {
      reminders: reminders.data.map(toReminder),
      completions: completions.data.map(toCompletion),
    };
  },

  async get(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders").select(REMINDER_COLUMNS).eq("id", id)
      .maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data ? toReminder(data) : null;
  },

  async lastCompletedOn(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminder_completions").select("occurrence_on")
      .eq("reminder_id", id).order("occurrence_on", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data?.occurrence_on ?? null;
  },

  /** The owner comes from `userId`, the authenticated caller, never from the input. */
  async create(userId, values) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders")
      .insert({ ...columns(values), user_id: userId, title: values.title, starts_on: values.startsOn })
      .select(REMINDER_COLUMNS).single();
    if (error) throw translateDatabaseError(error, SAVE_ERROR);
    return toReminder(data);
  },

  async update(id, values) {
    const changes = columns(values);
    if (Object.keys(changes).length === 0) return supabaseReminderRepository.get(id);

    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders").update(changes).eq("id", id)
      .select(REMINDER_COLUMNS).maybeSingle();
    if (error) throw translateDatabaseError(error, SAVE_ERROR);
    return data ? toReminder(data) : null;
  },

  async delete(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw translateDatabaseError(error, DELETE_ERROR);
    return data !== null;
  },

  /**
   * Moves the reminder first, guarded on `next_due_on = occurrenceOn`: Postgres re-checks that
   * condition after a racing update commits, so of two concurrent mark-dones only one moves it and
   * the other gets the 409. The completion is recorded after, with `expense_id` (the insert policy
   * accepts only the caller's own expense); one that already exists (the same date marked done
   * before an edit moved the schedule back) is left as it is, except that it gets `expenseId` when
   * it has no expense yet.
   */
  async complete(id, occurrenceOn, next, expenseId = null) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("reminders")
      .update(columns({ ...next, snoozedUntil: null }))
      .eq("id", id).eq("next_due_on", occurrenceOn)
      .select(REMINDER_COLUMNS).maybeSingle();
    if (error) throw translateDatabaseError(error, COMPLETE_ERROR);
    if (!data) {
      // Missing, or its open occurrence already moved on.
      if (await supabaseReminderRepository.get(id)) throw occurrenceAlreadyDoneError();
      return null;
    }

    const { error: completionError } = await supabase.from("reminder_completions")
      .insert({ reminder_id: id, occurrence_on: occurrenceOn, expense_id: expenseId });
    if (completionError && completionError.code !== "23505") {
      throw translateDatabaseError(completionError, COMPLETE_ERROR);
    }
    if (completionError && expenseId !== null) {
      // The completion already existed: link the expense unless one is linked already.
      const { error: linkError } = await supabase.from("reminder_completions").update({ expense_id: expenseId })
        .eq("reminder_id", id).eq("occurrence_on", occurrenceOn).is("expense_id", null);
      if (linkError) throw translateDatabaseError(linkError, COMPLETE_ERROR);
    }
    return toReminder(data);
  },

  async summary(now) {
    const supabase = await createClient();
    // Every reminder (a user has few), counted in TS: the due day depends on each one's time zone.
    const { data, error } = await supabase.from("reminders").select("time_of_day, timezone, next_due_on, snoozed_until");
    if (error) throw new Error(LOAD_ERROR);
    return summarizeReminders(data.map((row) => ({
      timeOfDay: row.time_of_day.slice(0, 5),
      timezone: row.timezone,
      nextDueOn: row.next_due_on,
      snoozedUntil: row.snoozed_until,
    })), now);
  },
};
