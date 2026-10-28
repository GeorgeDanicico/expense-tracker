import { z } from "zod";

import { addDays } from "@/lib/calendar";
import { DomainError } from "@/lib/errors";
import type { CurrentMember } from "@/lib/family/repository";
import { NO_FAMILY_MESSAGE } from "@/lib/family-calendar/repository";
import { timingOf } from "@/lib/family-calendar/series";
import { createEvent, deleteEvent, EVENT_NOT_FOUND_MESSAGE, listEvents, updateEvent } from "@/lib/family-calendar/service";
import {
  DEFAULT_EVENT_TIMEZONE,
  EDIT_SCOPES,
  MAX_RANGE_DAYS,
  MAX_SERIES_LENGTH,
  MIN_REPEAT_COUNT,
  type CalendarEvent,
} from "@/lib/family-calendar/types";
import { CREATE, defineTool, DELETE, READ, UPDATE } from "@/lib/mcp/define-tool";
import { familyMembers, requireMember, resolveMember } from "@/lib/mcp/tools/members";
import { zonedTimeToUtc } from "@/lib/time-zone";
import { calendarEventEditSchema, calendarEventSchema } from "@/lib/validation/calendar-event";
import { calendarDate, idSchema } from "@/lib/validation/primitives";

// The tools run as the caller, through the same service as the REST routes: the repository only
// ever sees the caller's family, so an id from another family is "not found" like any missing one.
// Dates are YYYY-MM-DD and times HH:MM, in Europe/Bucharest (the server's instructions say so).

const EVERYONE = "everyone";

const date = calendarDate.describe("YYYY-MM-DD");
const time = z.string().describe("HH:MM, 24-hour");
const names = z.array(z.string().trim().min(1, "Name a family member, \"me\" or \"everyone\"."))
  .min(1, "Name at least one attendee.");
const scope = z.enum(EDIT_SCOPES).default("this")
  .describe("For an event in a repeating series: this (just this event), following (this and the later ones) or all (the whole series)");

const listSchema = z.object({
  from: date,
  to: date.optional().describe("The last day to include; defaults to from"),
  member: z.string().trim().min(1).optional().describe("Only the events this family member attends: a name or \"me\""),
});

const addSchema = z.object({
  title: z.string(),
  startDate: date,
  startTime: time.optional().describe("Required unless allDay"),
  endDate: date.optional().describe("The last day; defaults to startDate"),
  endTime: time.optional().describe("Required unless allDay"),
  allDay: z.boolean().default(false),
  attendees: names.optional().describe("Member names, \"me\" or \"everyone\"; defaults to just the caller"),
  repeat: z.enum(["daily", "weekly"]).optional().describe("Weekly repeats on the same weekday; needs repeatCount"),
  repeatCount: z.number().int().optional()
    .describe(`How many occurrences in all, ${MIN_REPEAT_COUNT} to ${MAX_SERIES_LENGTH}, the first included`),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  id: idSchema(),
  scope,
  title: z.string().optional(),
  startDate: date.optional().describe("Moves every event in the scope by the same number of days"),
  startTime: time.nullable().optional(),
  endDate: date.optional(),
  endTime: time.nullable().optional(),
  allDay: z.boolean().optional(),
  attendees: names.optional().describe("Replaces the attendees: member names, \"me\" or \"everyone\""),
  location: z.string().optional(),
  notes: z.string().optional(),
});

const deleteSchema = z.object({ id: idSchema(), scope });

/**
 * An event as the tools show it: the attendees by name and the times as the form states them (an
 * all-day event's `endDate` is its last day, included), so what `list_events` returns can go
 * straight back into `update_event`.
 */
function toolEvent(event: CalendarEvent) {
  const { startDate, startTime, endDate, endTime } = timingOf(event, event.timezone);
  return {
    id: event.id,
    title: event.title,
    allDay: event.allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    attendees: event.attendees.map((attendee) => attendee.name ?? "(unnamed)"),
    location: event.location,
    notes: event.notes,
    repeat: event.seriesRepeat === "none"
      ? null
      : { kind: event.seriesRepeat, occurrence: event.seriesIndex, of: event.seriesLength },
  };
}

/** The member ids for `attendees`: names or "me", or every member of the family for "everyone". */
async function resolveAttendees(me: CurrentMember, attendees: readonly string[]): Promise<string[]> {
  if (attendees.some((name) => name.toLowerCase() === EVERYONE)) {
    return (await familyMembers()).map((member) => member.memberId);
  }
  return [...new Set(await Promise.all(attendees.map((name) => resolveMember(me, name, "attendees"))))];
}

/** Drops the keys whose value is undefined, so an edit only holds what the caller gave. */
const defined = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

export const calendarTools = [
  defineTool({
    name: "list_events",
    title: "List calendar events",
    description: `Events on the family calendar from one day to another (at most ${MAX_RANGE_DAYS} days), in time order, `
      + "with who is attending. Daily and weekly repeats are listed one event per occurrence.",
    schema: listSchema,
    annotations: READ,
    run: async ({ from, to, member }) => {
      const me = await requireMember(NO_FAMILY_MESSAGE);
      const memberId = member === undefined ? undefined : await resolveMember(me, member, "member");
      // Whole days in Bucharest: from midnight of `from` up to midnight after `to`.
      const range = {
        from: zonedTimeToUtc(from, "00:00", DEFAULT_EVENT_TIMEZONE),
        to: zonedTimeToUtc(addDays(to ?? from, 1), "00:00", DEFAULT_EVENT_TIMEZONE),
        memberId,
      };
      return { events: (await listEvents(range)).map(toolEvent) };
    },
  }),
  defineTool({
    name: "add_event",
    title: "Add calendar event",
    description: "Add an event to the family calendar, for the caller unless attendees say otherwise. "
      + "A daily or weekly repeat adds every occurrence (2 to 10). Members of the family are notified, "
      + "30 minutes before a timed event and at 07:30 for an all-day one.",
    schema: addSchema,
    annotations: CREATE,
    run: async ({ attendees, repeat, repeatCount, ...fields }) => {
      const me = await requireMember(NO_FAMILY_MESSAGE);
      const attendeeMemberIds = attendees === undefined ? [me.memberId] : await resolveAttendees(me, attendees);
      const input = calendarEventSchema.parse({
        ...defined(fields),
        attendeeMemberIds,
        repeat: repeat === undefined ? undefined : { kind: repeat, count: repeatCount },
      });
      return { events: (await createEvent(input)).map(toolEvent) };
    },
  }),
  defineTool({
    name: "update_event",
    title: "Update calendar event",
    description: "Change an event's title, times, attendees, location or notes. In a repeating series, scope picks "
      + "which occurrences change. A repeat itself can't be changed: delete the following events or add a new series.",
    schema: updateSchema,
    annotations: UPDATE,
    run: async ({ id, attendees, ...fields }) => {
      const me = await requireMember(NO_FAMILY_MESSAGE);
      const attendeeMemberIds = attendees === undefined ? undefined : await resolveAttendees(me, attendees);
      const edit = calendarEventEditSchema.parse({ ...defined(fields), ...defined({ attendeeMemberIds }) });
      return { events: (await updateEvent(id, edit)).map(toolEvent) };
    },
  }),
  defineTool({
    name: "delete_event",
    title: "Delete calendar event",
    description: "Permanently delete an event from the family calendar. In a repeating series, scope picks which occurrences go.",
    schema: deleteSchema,
    annotations: DELETE,
    run: async ({ id, scope }) => {
      await requireMember(NO_FAMILY_MESSAGE);
      const deletedIds = await deleteEvent(id, scope);
      if (deletedIds.length === 0) throw new DomainError(EVENT_NOT_FOUND_MESSAGE, 404);
      return { deleted: true, deletedIds };
    },
  }),
];
