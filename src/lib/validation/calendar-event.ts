import { z } from "zod";

import { isValidDate } from "@/lib/calendar";
import { timingProblem } from "@/lib/family-calendar/series";
import { EDIT_SCOPES, MAX_SERIES_LENGTH, MIN_REPEAT_COUNT, SERIES_REPEATS } from "@/lib/family-calendar/types";
import { calendarDate, idSchema } from "@/lib/validation/primitives";

const title = z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters.");
const notes = z.string().trim().max(2000, "Use at most 2,000 characters.");
const location = z.string().trim().max(200, "Use at most 200 characters.");
const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00.");
const isTime = (value: string | null): value is string => value !== null && time.safeParse(value).success;
const attendeeMemberIds = z
  .array(idSchema("Choose members of your family."))
  .min(1, "Choose at least one attendee.")
  .transform((ids) => [...new Set(ids)]);

/**
 * How a new event repeats: `none`, or `daily` or `weekly` with a `count` of 2 to 10 occurrences
 * (the first included). A one-off's count is always 1.
 */
const repeat = z.object({
  kind: z.enum(SERIES_REPEATS),
  count: z.number().int("Use a whole number.").optional(),
}).superRefine((value, context) => {
  if (value.kind === "none") return;
  if (value.count === undefined || value.count < MIN_REPEAT_COUNT || value.count > MAX_SERIES_LENGTH) {
    context.addIssue({
      code: "custom",
      path: ["count"],
      message: `Repeat ${MIN_REPEAT_COUNT} to ${MAX_SERIES_LENGTH} times.`,
    });
  }
}).transform((value) => ({ kind: value.kind, count: value.kind === "none" ? 1 : (value.count ?? 1) }));

/**
 * A new event as the form sends it, times in the event's time zone. Text is trimmed; notes and
 * location default to empty, the event to timed, the end date to the start date, the repeat to a
 * one-off. A timed event needs both times and ends after it starts; an all-day event's end date is
 * its last day and its times are dropped. An event lasts at most 30 days.
 */
export const calendarEventSchema = z.object({
  title,
  notes: notes.default(""),
  location: location.default(""),
  allDay: z.boolean().default(false),
  startDate: calendarDate,
  startTime: time.nullable().default(null),
  endDate: calendarDate.optional(),
  endTime: time.nullable().default(null),
  attendeeMemberIds,
  repeat: repeat.default({ kind: "none", count: 1 }),
}).superRefine((event, context) => {
  if (!event.allDay) {
    if (event.startTime === null) context.addIssue({ code: "custom", path: ["startTime"], message: "Choose a start time." });
    if (event.endTime === null) context.addIssue({ code: "custom", path: ["endTime"], message: "Choose an end time." });
  }

  // Object checks run even when a field failed its own, so only look at fields that passed.
  const endDate = event.endDate ?? event.startDate;
  if (!isValidDate(event.startDate) || !isValidDate(endDate)) return;
  if (!event.allDay && !(isTime(event.startTime) && isTime(event.endTime))) return;

  const problem = timingProblem({ ...event, endDate });
  if (problem) context.addIssue({ code: "custom", path: [problem.field], message: problem.message });
}).transform((event) => ({
  ...event,
  endDate: event.endDate ?? event.startDate,
  startTime: event.allDay ? null : event.startTime,
  endTime: event.allDay ? null : event.endTime,
}));

export type CalendarEventInput = z.output<typeof calendarEventSchema>;

/**
 * A change to an event: any subset of its fields, at least one, and the `scope` it applies to
 * (`this` by default). A repeat can't change once the event is created. The dates and times are
 * checked against each other only when the edit gives both; the service checks the rest against
 * the stored event (`editedRows`). A null time is the same as none.
 */
export const calendarEventEditSchema = z.object({
  title: title.optional(),
  notes: notes.optional(),
  location: location.optional(),
  allDay: z.boolean().optional(),
  startDate: calendarDate.optional(),
  startTime: time.nullable().optional(),
  endDate: calendarDate.optional(),
  endTime: time.nullable().optional(),
  attendeeMemberIds: attendeeMemberIds.optional(),
  scope: z.enum(EDIT_SCOPES).default("this"),
}).strict().superRefine((edit, context) => {
  if (!Object.entries(edit).some(([key, value]) => key !== "scope" && value !== undefined)) {
    context.addIssue({ code: "custom", message: "Change at least one field." });
  }

  if (edit.startDate && edit.endDate && isValidDate(edit.startDate) && isValidDate(edit.endDate)
    && edit.endDate < edit.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "The event can't end before it starts." });
  }
});

export type CalendarEventEdit = z.output<typeof calendarEventEditSchema>;
