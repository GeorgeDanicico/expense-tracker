import { compareEvents } from "@/lib/family-calendar/days";
import { editedRows, seriesRows, type StoredRow } from "@/lib/family-calendar/series";
import {
  DEFAULT_EVENT_TIMEZONE,
  type CalendarAttendee,
  type CalendarEvent,
  type EditScope,
} from "@/lib/family-calendar/types";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

/**
 * What the calendar shows between saving and the server's answer: the events as they will be once
 * the write succeeds, worked out here with the same functions the server uses (`seriesRows`,
 * `editedRows`) over the events the page has loaded. The server's answer replaces them: after every
 * write the page refetches. Pure.
 */

/** The id prefix of an event the server hasn't confirmed yet. */
export const PENDING_ID_PREFIX = "pending-";

export const isPendingEvent = (event: Pick<CalendarEvent, "id">) => event.id.startsWith(PENDING_ID_PREFIX);

const byStart = (a: CalendarEvent, b: CalendarEvent) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || compareEvents(a, b);

/** `events` with the occurrences of the new `input` added, as unconfirmed events. */
export function withPendingEvents(
  events: readonly CalendarEvent[],
  input: CalendarEventInput,
  attendees: readonly CalendarAttendee[],
  createdBy: string | null,
  now = new Date(),
): CalendarEvent[] {
  const seriesId = `${PENDING_ID_PREFIX}${now.getTime()}`;
  const created = seriesRows(input, DEFAULT_EVENT_TIMEZONE).map((row): CalendarEvent => ({
    id: `${seriesId}-${row.seriesIndex}`,
    seriesId,
    seriesIndex: row.seriesIndex,
    seriesLength: input.repeat.kind === "none" ? 1 : input.repeat.count,
    seriesRepeat: input.repeat.kind,
    title: input.title,
    notes: input.notes,
    location: input.location,
    allDay: input.allDay,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: DEFAULT_EVENT_TIMEZONE,
    attendees: [...attendees],
    createdBy,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
  return [...events, ...created].sort(byStart);
}

/** Whether `event` is reached by `scope` from the occurrence `anchor`. */
export function inScope(event: CalendarEvent, anchor: CalendarEvent, scope: EditScope) {
  if (event.id === anchor.id) return true;
  if (scope === "this" || event.seriesId !== anchor.seriesId) return false;
  return scope === "all" || event.seriesIndex >= anchor.seriesIndex;
}

const stored = (event: CalendarEvent): StoredRow => ({
  id: event.id,
  seriesIndex: event.seriesIndex,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  allDay: event.allDay,
});

/**
 * `events` with the edit applied to the occurrence `id` and, by `edit.scope`, those after it or the
 * whole series, as far as they are among `events`. `attendees` replaces the attendees when the edit
 * sets them. Returns `events` unchanged when `id` isn't among them or the new times aren't valid (the
 * server will say why).
 */
export function withEditedEvent(
  events: readonly CalendarEvent[],
  id: string,
  edit: CalendarEventEdit,
  attendees?: readonly CalendarAttendee[],
  now = new Date(),
): CalendarEvent[] {
  const anchor = events.find((event) => event.id === id);
  if (!anchor) return [...events];
  const reached = events.filter((event) => inScope(event, anchor, edit.scope));

  let timing: Map<string, ReturnType<typeof editedRows>[number]>;
  try {
    timing = new Map(editedRows(reached.map(stored), edit, anchor.timezone, id).map((row) => [row.id, row]));
  } catch {
    return [...events];
  }

  return events.map((event) => {
    const next = timing.get(event.id);
    if (!next) return event;
    return {
      ...event,
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
      ...(edit.location !== undefined ? { location: edit.location } : {}),
      ...(attendees ? { attendees: [...attendees] } : {}),
      allDay: next.allDay,
      startsAt: next.startsAt.toISOString(),
      endsAt: next.endsAt.toISOString(),
      updatedAt: now.toISOString(),
    };
  }).sort(byStart);
}

/** `events` without the occurrence `id` and, by `scope`, those after it or the whole series. */
export function withoutEvents(events: readonly CalendarEvent[], id: string, scope: EditScope): CalendarEvent[] {
  const anchor = events.find((event) => event.id === id);
  if (!anchor) return [...events];
  return events.filter((event) => !inScope(event, anchor, scope));
}
