import { addDays } from "@/lib/calendar";
import { DomainError } from "@/lib/errors";
import { MAX_EVENT_DAYS, MAX_SERIES_LENGTH, type SeriesRepeat } from "@/lib/family-calendar/types";
import { utcToZoned, wallClockToMs, zonedTimeToUtc } from "@/lib/time-zone";

/**
 * The rows of a repeating event, and the new times of the rows an edit touches. Pure, and shared
 * by the API and the MCP tools (docs/calendar-plan.md, "Why repeats are separate rows").
 *
 * Every occurrence is worked out on the wall clock and converted to an instant on its own, so a
 * 09:00 event stays 09:00 local across a clock change. Dates are `YYYY-MM-DD` and times `HH:MM`
 * in the event's time zone. An all-day event has no times and its `endDate` is its last day,
 * included; stored, it runs from local midnight of the first day to local midnight after the last.
 */

const DAY = 24 * 60 * 60_000;
const MIDNIGHT = "00:00";

/** When an event happens, as the form states it. */
export type EventTiming = {
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
};

/** The occurrences to create: nothing, or a daily or weekly repeat of `count` (2–10) of them. */
export type SeriesRepeatInput = { kind: SeriesRepeat; count: number };

/** One occurrence to insert. `seriesIndex` counts from 1. */
export type NewSeriesRow = { seriesIndex: number; startsAt: Date; endsAt: Date };

/** A stored occurrence's timing, with instants as ISO strings. */
export type StoredRow = { id: string; seriesIndex: number; startsAt: string; endsAt: string; allDay: boolean };

/** The new timing of a stored occurrence. */
export type EditedRow = { id: string; seriesIndex: number; startsAt: Date; endsAt: Date; allDay: boolean };

/** The fields of an edit that change when an event happens; each one absent (or null) is left as it is. */
export type TimingEdit = {
  allDay?: boolean;
  startDate?: string;
  startTime?: string | null;
  endDate?: string;
  endTime?: string | null;
};

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

/**
 * What is wrong with the span of `timing`, if anything: an end before the start, or an event
 * longer than `MAX_EVENT_DAYS`. `field` is the form field to attach the message to.
 */
export function timingProblem(timing: EventTiming): { field: "endDate" | "endTime"; message: string } | null {
  if (timing.allDay) {
    if (timing.endDate < timing.startDate) return { field: "endDate", message: "The last day can't be before the first." };
    if (daysBetween(timing.startDate, timing.endDate) + 1 > MAX_EVENT_DAYS) {
      return { field: "endDate", message: `An event can last at most ${MAX_EVENT_DAYS} days.` };
    }
    return null;
  }

  const start = wallClockToMs(timing.startDate, timing.startTime!);
  const end = wallClockToMs(timing.endDate, timing.endTime!);
  if (end <= start) return { field: "endTime", message: "The event must end after it starts." };
  if (end - start > MAX_EVENT_DAYS * DAY) {
    return { field: "endDate", message: `An event can last at most ${MAX_EVENT_DAYS} days.` };
  }
  return null;
}

/** The instants of an event's start and end in `timeZone`. */
function instants(timing: EventTiming, timeZone: string) {
  if (timing.allDay) {
    return {
      startsAt: zonedTimeToUtc(timing.startDate, MIDNIGHT, timeZone),
      endsAt: zonedTimeToUtc(addDays(timing.endDate, 1), MIDNIGHT, timeZone),
    };
  }
  if (timing.startTime === null || timing.endTime === null) {
    throw new RangeError("A timed event needs a start time and an end time.");
  }
  return {
    startsAt: zonedTimeToUtc(timing.startDate, timing.startTime, timeZone),
    endsAt: zonedTimeToUtc(timing.endDate, timing.endTime, timeZone),
  };
}

/** `timing` moved `days` days on, with its times and length unchanged. */
function shifted(timing: EventTiming, days: number): EventTiming {
  return { ...timing, startDate: addDays(timing.startDate, days), endDate: addDays(timing.endDate, days) };
}

/**
 * The 1–10 rows to insert for a new event. A daily repeat moves each occurrence a day on, a weekly
 * one a week; each keeps the first one's times and length on the wall clock. A one-off is one row.
 */
export function seriesRows(
  event: EventTiming & { repeat: SeriesRepeatInput },
  timeZone: string,
): NewSeriesRow[] {
  const { kind, count } = event.repeat;
  const length = kind === "none" ? 1 : count;
  if (!Number.isInteger(length) || length < 1 || length > MAX_SERIES_LENGTH) {
    throw new RangeError(`A series has 1 to ${MAX_SERIES_LENGTH} occurrences, not ${count}.`);
  }

  const step = kind === "weekly" ? 7 : 1;
  return Array.from({ length }, (_, index) => ({
    seriesIndex: index + 1,
    ...instants(shifted(event, step * index), timeZone),
  }));
}

/** A stored row's timing read back on the wall clock of `timeZone`. */
function timingOf(row: StoredRow, timeZone: string): EventTiming {
  const start = utcToZoned(new Date(row.startsAt), timeZone);
  const end = utcToZoned(new Date(row.endsAt), timeZone);
  return row.allDay
    ? { allDay: true, startDate: start.date, startTime: null, endDate: addDays(end.date, -1), endTime: null }
    : { allDay: false, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
}

/**
 * The new times of `rows`, the occurrences an edit touches, for an edit made on the one with id
 * `anchorId` (the occurrence the person opened; it is among `rows`).
 *
 * - A new start date moves every row by the number of days the anchor moved, and a new end date
 *   moves each row's end by the days the anchor's end moved (by the start's days when it isn't
 *   given, so a moved event keeps its length). A date shift never changes a row's time.
 * - A new start or end time is set on every row's own date.
 * - Switching to all-day keeps each row's dates; switching to timed keeps them too and needs both
 *   times in the edit.
 *
 * Throws a `DomainError` (422) when a row would end up too long, end before it starts, or be timed
 * without times. An edit that changes no timing returns the rows' stored instants as they are.
 */
export function editedRows(
  rows: readonly StoredRow[],
  edit: TimingEdit,
  timeZone: string,
  anchorId: string,
): EditedRow[] {
  const anchor = rows.find((row) => row.id === anchorId);
  if (!anchor) throw new RangeError(`The edited event ${anchorId} isn't among the rows to edit.`);

  const changesTiming = [edit.allDay, edit.startDate, edit.startTime, edit.endDate, edit.endTime]
    .some((value) => value !== undefined && value !== null);
  if (!changesTiming) {
    return rows.map((row) => ({ ...row, startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt) }));
  }

  const anchorTiming = timingOf(anchor, timeZone);
  const startShift = edit.startDate === undefined ? 0 : daysBetween(anchorTiming.startDate, edit.startDate);
  const endShift = edit.endDate === undefined ? startShift : daysBetween(anchorTiming.endDate, edit.endDate);
  const allDay = edit.allDay ?? anchor.allDay;

  return rows.map((row) => {
    const current = timingOf(row, timeZone);
    const timing: EventTiming = {
      allDay,
      startDate: addDays(current.startDate, startShift),
      startTime: allDay ? null : edit.startTime ?? current.startTime,
      endDate: addDays(current.endDate, endShift),
      endTime: allDay ? null : edit.endTime ?? current.endTime,
    };

    const problem = !allDay && (timing.startTime === null || timing.endTime === null)
      ? timing.startTime === null
        ? { field: "startTime", message: "Choose a start time." }
        : { field: "endTime", message: "Choose an end time." }
      : timingProblem(timing);
    if (problem) throw new DomainError(problem.message, 422, { [problem.field]: [problem.message] });

    return { id: row.id, seriesIndex: row.seriesIndex, allDay, ...instants(timing, timeZone) };
  });
}
