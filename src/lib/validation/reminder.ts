import { z } from "zod";

import {
  DEFAULT_LEAD_MINUTES,
  DEFAULT_TIME_OF_DAY,
  LEAD_MINUTES,
  MAX_LEAD_TIMES,
  MAX_REPEAT_INTERVAL,
  MIN_REPEAT_INTERVAL,
  REPEAT_UNITS,
} from "@/lib/reminders/types";
import { isSupportedCurrency } from "@/lib/utils/currency";
import { expenseSchema } from "@/lib/validation/expense";
import { calendarDate } from "@/lib/validation/primitives";

const title = z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters.");
const notes = z.string().trim().max(2000, "Use at most 2,000 characters.");
const timeOfDay = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");
const repeatInterval = z
  .number()
  .int("Use a whole number.")
  .min(MIN_REPEAT_INTERVAL, `Repeat at least every ${MIN_REPEAT_INTERVAL}.`)
  .max(MAX_REPEAT_INTERVAL, `Repeat at most every ${MAX_REPEAT_INTERVAL}.`);
const leadMinutes = z
  .array(z.number().refine((value) => LEAD_MINUTES.includes(value as never), "Choose one of the lead times."))
  .max(MAX_LEAD_TIMES, `Choose at most ${MAX_LEAD_TIMES} lead times.`)
  .refine((values) => new Set(values).size === values.length, "Choose each lead time once.")
  .transform((values) => [...values].sort((a, b) => a - b));

const expenseFields = expenseSchema.shape;

/**
 * The expense a reminder logs when marked done (R12): its amount, category and subtype checked by
 * the expense form's own schema (`expenseSchema`), and the account currency it was saved in. The
 * description and date come from the reminder when the expense is logged.
 */
export const expenseTemplateSchema = z.object({
  amount: expenseFields.amount,
  currency: z.string().trim().toUpperCase().refine(isSupportedCurrency, "Choose a supported currency."),
  category: expenseFields.category,
  subtype: expenseFields.subtype,
}).superRefine((template, context) => {
  // The expense schema's cross-field rules (a subtype belonging to its category), on the expense
  // this template logs; the description and date are placeholders it fills in when logging. Its
  // field rules already ran above, through the same field schemas, so only its own checks are kept.
  const parsed = expenseSchema.safeParse({ ...template, description: "Reminder", expenseDate: "2000-01-01" });
  for (const issue of parsed.error?.issues ?? []) {
    if (issue.code === "custom") context.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

export type ExpenseTemplateInput = z.output<typeof expenseTemplateSchema>;

/**
 * A reminder as the form sends it. Text is trimmed; notes default to empty, the time to 09:00,
 * the repeat to a one-off, the lead time to "at the time", the expense template to none. A one-off's
 * interval is always 1.
 */
export const reminderSchema = z.object({
  title,
  notes: notes.default(""),
  startsOn: calendarDate,
  timeOfDay: timeOfDay.default(DEFAULT_TIME_OF_DAY),
  repeatUnit: z.enum(REPEAT_UNITS).default("none"),
  repeatInterval: repeatInterval.default(MIN_REPEAT_INTERVAL),
  leadMinutes: leadMinutes.default([...DEFAULT_LEAD_MINUTES]),
  notificationsMuted: z.boolean().default(false),
  /** Null (the default) for a reminder that logs no expense. */
  expenseTemplate: expenseTemplateSchema.nullable().default(null),
}).transform((reminder) => (
  reminder.repeatUnit === "none" ? { ...reminder, repeatInterval: MIN_REPEAT_INTERVAL } : reminder
));

export type ReminderInput = z.output<typeof reminderSchema>;

/**
 * How long to snooze: an hour, until tomorrow 09:00, or `until` a chosen instant (ISO, UTC or
 * with an offset), which must be in the future when parsed.
 */
export const snoozeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hour") }),
  z.object({ kind: z.literal("tomorrow") }),
  z.object({
    kind: z.literal("until"),
    until: z.iso.datetime({ offset: true, error: "Use an ISO timestamp." })
      .transform((value) => new Date(value).toISOString())
      .refine((value) => new Date(value).getTime() > Date.now(), "Choose a time in the future."),
  }),
]);

export type SnoozeInput = z.output<typeof snoozeSchema>;

/** The reminders list's query: `doneSince` (ISO, UTC or with an offset) bounds the completions. */
export const reminderListQuerySchema = z.object({
  doneSince: z.iso.datetime({ offset: true, error: "Use an ISO timestamp for doneSince." })
    .transform((value) => new Date(value).toISOString())
    .optional(),
});

/**
 * The optional body of `POST /api/reminders/[id]/complete`. Without one (or with `logExpense`
 * false) it only marks the open occurrence done. With `logExpense: true` it first logs the
 * reminder's expense template for the occurrence, with `amount` replacing the template's when
 * given. `occurrenceOn` is the open occurrence the caller saw: when the reminder has moved on since,
 * the call is refused with a 409 and nothing changes.
 */
export const completeReminderSchema = z.object({
  logExpense: z.boolean().default(false),
  occurrenceOn: calendarDate.optional(),
  amount: expenseFields.amount.optional(),
});

export type CompleteReminderInput = z.output<typeof completeReminderSchema>;
