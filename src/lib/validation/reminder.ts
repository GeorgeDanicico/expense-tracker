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

/**
 * A reminder as the form sends it. Text is trimmed; notes default to empty, the time to 09:00,
 * the repeat to a one-off, the lead time to "at the time". A one-off's interval is always 1.
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
