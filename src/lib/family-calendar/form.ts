import { addDays } from "@/lib/calendar";
import {
  DEFAULT_EVENT_TIMEZONE,
  MAX_SERIES_LENGTH,
  MIN_REPEAT_COUNT,
  type CalendarEvent,
  type EditScope,
  type SeriesRepeat,
} from "@/lib/family-calendar/types";
import { msToWallClock, utcToZoned, wallClockToMs } from "@/lib/time-zone";
import {
  calendarEventEditSchema,
  calendarEventSchema,
  type CalendarEventEdit,
  type CalendarEventInput,
} from "@/lib/validation/calendar-event";

/**
 * The event form's state and how it maps to the API: a draft (every field a string or a plain
 * value, the way inputs hold them), the body to create an event from it, and the changed fields
 * to edit one with. Pure; the dialog only wires inputs to it.
 */

export type EventDraft = {
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** For an all-day event the last day, included. */
  endDate: string;
  endTime: string;
  attendeeMemberIds: string[];
  /** Only used when creating: a repeat can't change afterwards. */
  repeatKind: SeriesRepeat;
  repeatCount: number;
};

export const DEFAULT_REPEAT_COUNT = 4;

const DEFAULT_START_TIME = "09:00";
const HOUR = 60;

/**
 * A new event on `date`: one hour long, for `attendeeMemberIds` (just the caller by default). On
 * today it starts at the next full hour (at 22:00 at the latest, so it ends the same day); on any
 * other day at 09:00.
 */
export function newDraft({
  date,
  startTime,
  allDay = false,
  attendeeMemberIds,
  now = new Date(),
  timeZone = DEFAULT_EVENT_TIMEZONE,
}: {
  date: string;
  /** A start time to use instead (from a slot clicked in the Week view). */
  startTime?: string;
  /** An all-day event (from the Week view's all-day row), which keeps the usual start time for when the switch is turned off. */
  allDay?: boolean;
  attendeeMemberIds: string[];
  now?: Date;
  timeZone?: string;
}): EventDraft {
  const local = utcToZoned(now, timeZone);
  const start = startTime
    ?? (local.date === date
      ? `${String(Math.min(Number(local.time.slice(0, 2)) + 1, 22)).padStart(2, "0")}:00`
      : DEFAULT_START_TIME);
  // An event starting in the day's last hour ends after midnight, on the next day.
  const end = addMinutes(date, start, HOUR);
  return {
    title: "",
    notes: "",
    location: "",
    allDay,
    startDate: date,
    startTime: start,
    endDate: allDay ? date : end.date,
    endTime: end.time,
    attendeeMemberIds,
    repeatKind: "none",
    repeatCount: DEFAULT_REPEAT_COUNT,
  };
}

/** The draft for editing `event`, read on its own wall clock (an all-day event's end date is its last day). */
export function draftFromEvent(event: CalendarEvent): EventDraft {
  const start = utcToZoned(new Date(event.startsAt), event.timezone);
  const end = utcToZoned(new Date(event.endsAt), event.timezone);
  return {
    title: event.title,
    notes: event.notes,
    location: event.location,
    allDay: event.allDay,
    startDate: start.date,
    startTime: event.allDay ? DEFAULT_START_TIME : start.time,
    endDate: event.allDay ? addDays(end.date, -1) : end.date,
    endTime: event.allDay ? addMinutes(start.date, DEFAULT_START_TIME, HOUR).time : end.time,
    attendeeMemberIds: event.attendees.map((attendee) => attendee.memberId),
    repeatKind: "none",
    repeatCount: DEFAULT_REPEAT_COUNT,
  };
}

function addMinutes(date: string, time: string, minutes: number) {
  return msToWallClock(wallClockToMs(date, time) + minutes * 60_000);
}

/** `HH:MM` and a date as a wall clock number, or null while the inputs are empty or partial. */
function wallClock(date: string, time: string) {
  try {
    return wallClockToMs(date, time);
  } catch {
    return null;
  }
}

/**
 * The draft with a new start, its end moved by the same amount so the event keeps its length
 * (the way calendar apps do). An all-day event's days move by the same number of days. If the
 * end wasn't after the start to begin with, or a field is empty, the end stays where it was.
 */
export function withStart(draft: EventDraft, start: { startDate?: string; startTime?: string }): EventDraft {
  const next = { ...draft, ...start };
  if (draft.allDay) {
    if (!start.startDate || !draft.startDate || !draft.endDate) return next;
    const shift = Math.round((Date.parse(`${start.startDate}T00:00:00Z`) - Date.parse(`${draft.startDate}T00:00:00Z`)) / 86_400_000);
    return draft.endDate >= draft.startDate ? { ...next, endDate: addDays(draft.endDate, shift) } : next;
  }

  const before = [wallClock(draft.startDate, draft.startTime), wallClock(draft.endDate, draft.endTime)] as const;
  const after = wallClock(next.startDate, next.startTime);
  if (before[0] === null || before[1] === null || after === null || before[1] <= before[0]) return next;
  const end = msToWallClock(after + (before[1] - before[0]));
  return { ...next, endDate: end.date, endTime: end.time };
}

/** The draft with the all-day switch changed: an all-day event ends on its last day, so a one-day event stays one day. */
export function withAllDay(draft: EventDraft, allDay: boolean): EventDraft {
  if (allDay === draft.allDay) return draft;
  return { ...draft, allDay, ...(allDay && draft.endDate < draft.startDate ? { endDate: draft.startDate } : {}) };
}

/** The draft with a member added to or removed from the people going. */
export function toggleAttendee(draft: EventDraft, memberId: string): EventDraft {
  const going = draft.attendeeMemberIds.includes(memberId);
  return { ...draft, attendeeMemberIds: going ? draft.attendeeMemberIds.filter((id) => id !== memberId) : [...draft.attendeeMemberIds, memberId] };
}

/** The repeat count as a whole number within the form's limits; anything else (empty, 1, 40) is clamped. */
export function clampRepeatCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_REPEAT_COUNT;
  return Math.min(MAX_SERIES_LENGTH, Math.max(MIN_REPEAT_COUNT, Math.round(value)));
}

/** The body `POST /api/calendar/events` takes for `draft`. */
export function toCreatePayload(draft: EventDraft) {
  return {
    title: draft.title,
    notes: draft.notes,
    location: draft.location,
    allDay: draft.allDay,
    startDate: draft.startDate,
    startTime: draft.allDay ? null : draft.startTime,
    endDate: draft.endDate,
    endTime: draft.allDay ? null : draft.endTime,
    attendeeMemberIds: draft.attendeeMemberIds,
    repeat: draft.repeatKind === "none"
      ? { kind: "none" as const }
      : { kind: draft.repeatKind, count: clampRepeatCount(draft.repeatCount) },
  };
}

export type FieldErrors = Record<string, string[]>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

/**
 * The ids of the people going come from the family list, never from typing, and the server checks
 * their format and that they belong to the family. The schemas here want UUIDs, so they check a
 * stand-in for the ids (still failing for none) and the real ones are put back after.
 */
const STAND_IN_ID = "00000000-0000-4000-8000-000000000000";
const standIn = (ids: readonly string[]) => (ids.length > 0 ? [STAND_IN_ID] : []);
const unique = (ids: readonly string[]) => [...new Set(ids)];

/** `draft` checked the way the API checks it, so a mistake shows on its field before anything is saved. */
export function parseNewEvent(draft: EventDraft): Parsed<CalendarEventInput> {
  const parsed = calendarEventSchema.safeParse({ ...toCreatePayload(draft), attendeeMemberIds: standIn(draft.attendeeMemberIds) });
  return parsed.success
    ? { ok: true, value: { ...parsed.data, attendeeMemberIds: unique(draft.attendeeMemberIds) } }
    : { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as FieldErrors };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * The body `PATCH /api/calendar/events/[id]` takes: only what `draft` changed from `event`, and
 * `scope`. Null when nothing changed. The end date goes along whenever the start date or the end
 * date changed, because on the server a start date alone also moves the end by the same days.
 */
export function toEditPayload(event: CalendarEvent, draft: EventDraft, scope: EditScope): (Record<string, unknown> & { scope: EditScope }) | null {
  const before = draftFromEvent(event);
  const body: Record<string, unknown> = {};

  if (draft.title.trim() !== before.title) body.title = draft.title;
  if (draft.notes.trim() !== before.notes) body.notes = draft.notes;
  if (draft.location.trim() !== before.location) body.location = draft.location;
  if (!sameSet(draft.attendeeMemberIds, before.attendeeMemberIds)) body.attendeeMemberIds = draft.attendeeMemberIds;

  if (draft.allDay !== before.allDay) body.allDay = draft.allDay;
  if (draft.startDate !== before.startDate || draft.endDate !== before.endDate) {
    body.startDate = draft.startDate;
    body.endDate = draft.endDate;
  }
  // Times matter for a timed event only; switching to timed needs both.
  if (!draft.allDay && (draft.allDay !== before.allDay || draft.startTime !== before.startTime || draft.endTime !== before.endTime)) {
    body.startTime = draft.startTime;
    body.endTime = draft.endTime;
  }

  return Object.keys(body).length === 0 ? null : { ...body, scope };
}

/** The edit checked the way the API checks it; `null` when nothing changed. */
export function parseEdit(event: CalendarEvent, draft: EventDraft, scope: EditScope): Parsed<CalendarEventEdit> | null {
  const payload = toEditPayload(event, draft, scope);
  if (!payload) return null;
  const going = payload.attendeeMemberIds as string[] | undefined;
  const parsed = calendarEventEditSchema.safeParse(going ? { ...payload, attendeeMemberIds: standIn(going) } : payload);
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as FieldErrors };

  // The edit schema checks dates and times against each other only when it gets both; the form
  // always knows both, so check the whole event the way creating it would.
  const whole = parseNewEvent({ ...draft, repeatKind: "none" });
  if (!whole.ok) return whole;
  return { ok: true, value: going ? { ...parsed.data, attendeeMemberIds: unique(going) } : parsed.data };
}
