import "server-only";

import { DomainError } from "@/lib/errors";
import { notifyAt } from "@/lib/family-calendar/notify";
import type { CalendarRowEdit, NewCalendarRow } from "@/lib/family-calendar/repository";
import { editedRows, seriesRows, type StoredRow } from "@/lib/family-calendar/series";
import {
  DEFAULT_EVENT_TIMEZONE,
  MAX_RANGE_DAYS,
  type CalendarEvent,
  type EditScope,
} from "@/lib/family-calendar/types";
import { getRepositories } from "@/lib/repositories";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

// Use cases shared by the REST routes and the MCP tools; each transport only reshapes the result.
// Every write works the stored times out with series.ts and `notify_at` with notify.ts here, so no
// caller ever writes them itself. `now` is a parameter for tests. A repeat is one row per occurrence
// (docs/calendar-plan.md, "Why repeats are separate rows"), so a scope only picks which rows to touch.

export const EVENT_NOT_FOUND_MESSAGE = "Event not found.";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/**
 * The longest range a list may cover: `MAX_RANGE_DAYS` days, plus an hour because a range of that many
 * wall-clock days (from local midnight to local midnight) is an hour longer across the autumn clock change.
 */
export const MAX_RANGE_MS = MAX_RANGE_DAYS * DAY + HOUR;

/** The events to list: those overlapping `from` (included) to `to` (excluded), optionally one member's. */
export type EventRange = {
  from: Date;
  to: Date;
  /** Only the events this family member attends. */
  memberId?: string;
};

function notFound(): DomainError {
  return new DomainError(EVENT_NOT_FOUND_MESSAGE, 404);
}

function invalidRange(field: "from" | "to", message: string): DomainError {
  return new DomainError(message, 422, { [field]: [message] });
}

/**
 * The events of the caller's family overlapping the range, by start, each with its attendees and
 * series length; with `memberId`, only those that member attends. A 422 `DomainError` when the range is
 * invalid, empty or longer than `MAX_RANGE_DAYS` days; a 404 one when the caller has no family.
 */
export async function listEvents({ from, to, memberId }: EventRange): Promise<CalendarEvent[]> {
  if (Number.isNaN(from.getTime())) throw invalidRange("from", "Choose a valid start for the range.");
  if (Number.isNaN(to.getTime())) throw invalidRange("to", "Choose a valid end for the range.");
  if (to.getTime() <= from.getTime()) throw invalidRange("to", "The range must end after it starts.");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw invalidRange("to", `The range can cover at most ${MAX_RANGE_DAYS} days.`);
  }

  const events = await getRepositories().calendar.listBetween(from.toISOString(), to.toISOString());
  return memberId === undefined
    ? events
    : events.filter((event) => event.attendees.some((attendee) => attendee.memberId === memberId));
}

/** The caller's family's event, with its attendees and series length; a 404 `DomainError` when there is no such event. */
export async function getEvent(id: string): Promise<CalendarEvent> {
  const event = await getRepositories().calendar.get(id);
  if (!event) throw notFound();
  return event;
}

/**
 * Adds an event, and for a repeat every occurrence of it, as one series (all or nothing). Each
 * occurrence's times come from `seriesRows` and its `notify_at` from `notifyAt` as of `now` (null for an
 * occurrence whose notify time has passed). Returns the rows by `seriesIndex`: one for a one-off.
 * A 422 `DomainError` when an attendee isn't a member of the caller's family.
 */
export async function createEvent(input: CalendarEventInput, now: Date = new Date()): Promise<CalendarEvent[]> {
  const timezone = DEFAULT_EVENT_TIMEZONE;
  const rows = seriesRows(input, timezone).map((occurrence): NewCalendarRow => {
    const startsAt = occurrence.startsAt.toISOString();
    return {
      seriesIndex: occurrence.seriesIndex,
      seriesRepeat: input.repeat.kind,
      title: input.title,
      notes: input.notes,
      location: input.location,
      allDay: input.allDay,
      startsAt,
      endsAt: occurrence.endsAt.toISOString(),
      timezone,
      notifyAt: notifyAt({ startsAt, allDay: input.allDay, timezone }, now)?.toISOString() ?? null,
    };
  });
  return getRepositories().calendar.create(rows, input.attendeeMemberIds);
}

/**
 * The occurrences `scope` reaches from the event `id`: `this` the event, `following` it and every
 * later one of its series (`series_index >=` its own, so on the first occurrence that is the whole
 * series), `all` the whole series. Ordered by `seriesIndex`; the first of them is the event with this
 * id (`anchor`) for `this`. A 404 `DomainError` when the caller's family has no such event.
 */
async function eventsInScope(id: string, scope: EditScope): Promise<{ anchor: CalendarEvent; events: CalendarEvent[] }> {
  const { calendar } = getRepositories();
  const anchor = await calendar.get(id);
  if (!anchor) throw notFound();
  if (scope === "this") return { anchor, events: [anchor] };

  const series = await calendar.listSeries(anchor.seriesId);
  // Deleted between the two reads.
  if (!series.some((event) => event.id === id)) throw notFound();
  return {
    anchor,
    events: scope === "all" ? series : series.filter((event) => event.seriesIndex >= anchor.seriesIndex),
  };
}

const stored = (event: CalendarEvent): StoredRow => ({
  id: event.id,
  seriesIndex: event.seriesIndex,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  allDay: event.allDay,
});

/**
 * Edits the event `id` and, by `edit.scope` (`this` by default), the occurrences after it or the whole
 * series. Text fields are set on each occurrence. A new date moves each occurrence by the number of
 * days the opened one moves, and a new time is set on each occurrence's own date (`editedRows`, which
 * throws a 422 `DomainError` for a span that is too long, ends before it starts, or a timed event
 * without times). Attendees are replaced on every occurrence reached. An occurrence whose start or
 * all-day flag changes gets its `notify_at` worked out again as of `now` and its `notified_at`
 * cleared, so a moved event notifies again; one whose start is unchanged keeps both. Returns the
 * changed events by `seriesIndex`. A 404 `DomainError` when the caller's family has no such event.
 */
export async function updateEvent(id: string, edit: CalendarEventEdit, now: Date = new Date()): Promise<CalendarEvent[]> {
  const { anchor, events } = await eventsInScope(id, edit.scope);
  const timing = new Map(editedRows(events.map(stored), edit, anchor.timezone, id).map((row) => [row.id, row]));

  const rows = events.map((event): CalendarRowEdit => {
    const next = timing.get(event.id)!;
    const startsAt = next.startsAt.toISOString();
    const endsAt = next.endsAt.toISOString();
    const startMoved = next.startsAt.getTime() !== Date.parse(event.startsAt) || next.allDay !== event.allDay;
    const timingChanged = startMoved || next.endsAt.getTime() !== Date.parse(event.endsAt);

    return {
      id: event.id,
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
      ...(edit.location !== undefined ? { location: edit.location } : {}),
      ...(timingChanged ? { allDay: next.allDay, startsAt, endsAt } : {}),
      ...(startMoved
        ? {
          notifyAt: notifyAt({ startsAt, allDay: next.allDay, timezone: event.timezone }, now)?.toISOString() ?? null,
          notifiedAt: null,
        }
        : {}),
    };
  });
  return getRepositories().calendar.update(rows, edit.attendeeMemberIds);
}

/**
 * Deletes the event `id` and, by `scope` (`this` by default), the occurrences after it or the whole
 * series, with their attendees. Returns the ids deleted. A 404 `DomainError` when the caller's family
 * has no such event.
 */
export async function deleteEvent(id: string, scope: EditScope = "this"): Promise<string[]> {
  const { events } = await eventsInScope(id, scope);
  return getRepositories().calendar.delete(events.map((event) => event.id));
}
