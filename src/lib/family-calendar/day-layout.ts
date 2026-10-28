import { coversDay, isAllDayRowEvent } from "@/lib/family-calendar/days";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { utcToZoned } from "@/lib/time-zone";

/**
 * The Week view's hourly grid: where a timed event sits in a day's column and how events that
 * overlap share the column's width. Pure, so the view and the tests share it. Times are minutes
 * from local midnight; the grid covers the whole day, of which the view shows 07:00–22:00 and
 * scrolls to the rest.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** The hours the grid scrolls to and shows without scrolling: 07:00 to 22:00. */
export const VIEW_START_HOUR = 7;
export const VIEW_END_HOUR = 22;

/** An event shorter than this is drawn (and counted as overlapping) as if it were this long, so its title stays readable. */
export const MIN_EVENT_MINUTES = 30;

/** "09:30" as 570 minutes. */
export function minutesOfTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** 570 minutes as "09:30". */
export function timeOfMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A timed event in a day's column: where it sits in time, and which of the column's lanes it takes. */
export type DayColumnItem = {
  event: CalendarEvent;
  /** Minutes from local midnight to the event's start. */
  startMinute: number;
  /** Minutes from local midnight to its end, at least `MIN_EVENT_MINUTES` after the start and at most 24:00. */
  endMinute: number;
  /** The lane it takes, 0 for the leftmost. */
  column: number;
  /** How many lanes its group of overlapping events needs. */
  columns: number;
  /**
   * How many lanes wide the event is drawn, at least 1: it takes the lanes to its right that no
   * overlapping event uses, so a lone event beside a busy hour isn't squeezed. Its width is
   * `span / columns` of the day column and its left edge `column / columns`.
   */
  span: number;
};

/** `event`'s start and end as minutes on the local day `date` that it covers; an end on a later day is 24:00. */
function minutesOnDay(event: CalendarEvent, date: string, minimum: number) {
  const start = utcToZoned(new Date(event.startsAt), event.timezone);
  const end = utcToZoned(new Date(event.endsAt), event.timezone);
  const startMinute = start.date < date ? 0 : minutesOfTime(start.time);
  const endMinute = end.date > date ? MINUTES_PER_DAY : minutesOfTime(end.time);
  return { startMinute, endMinute: Math.min(MINUTES_PER_DAY, Math.max(endMinute, startMinute + minimum)) };
}

/**
 * Lays the timed events covering the local day `date` out in its column. All-day and multi-day
 * events (`isAllDayRowEvent`) are left to the all-day row. Overlapping events (one
 * starting before another has ended, directly or through a chain of overlaps) form a group; within
 * it each event takes the first lane free at its start, and the group is divided into as many
 * equal lanes as its busiest moment needs, so three side by side are a third each; an event also
 * widens into free lanes to its right (`span`). Events that merely
 * touch (one ends at 10:00, the next starts at 10:00) don't overlap and keep the full width. The
 * order of the input doesn't matter: events are placed by start, longer first, then title.
 */
export function layoutDayColumns(
  events: readonly CalendarEvent[],
  date: string,
  minimum = MIN_EVENT_MINUTES,
): DayColumnItem[] {
  const placed = events
    .filter((event) => !isAllDayRowEvent(event) && coversDay(event, date))
    .map((event) => ({ event, ...minutesOnDay(event, date, minimum) }))
    .sort((a, b) => a.startMinute - b.startMinute
      || b.endMinute - a.endMinute
      || a.event.title.localeCompare(b.event.title)
      || a.event.id.localeCompare(b.event.id));

  const items: DayColumnItem[] = [];
  let group: DayColumnItem[] = [];
  let groupEnd = 0;
  // `laneEnds[lane]` is when the lane's last event ends.
  let laneEnds: number[] = [];

  const closeGroup = () => {
    for (const item of group) {
      item.columns = laneEnds.length;
      // Grow to the right until a lane holds an event overlapping this one in time.
      while (item.column + item.span < item.columns
        && !group.some((other) => other.column === item.column + item.span
          && other.startMinute < item.endMinute && other.endMinute > item.startMinute)) {
        item.span += 1;
      }
    }
    group = [];
    laneEnds = [];
  };

  for (const { event, startMinute, endMinute } of placed) {
    if (group.length > 0 && startMinute >= groupEnd) closeGroup();
    let column = laneEnds.findIndex((end) => end <= startMinute);
    if (column === -1) column = laneEnds.length;
    laneEnds[column] = endMinute;
    groupEnd = group.length === 0 ? endMinute : Math.max(groupEnd, endMinute);
    const item: DayColumnItem = { event, startMinute, endMinute, column, columns: 1, span: 1 };
    group.push(item);
    items.push(item);
  }
  closeGroup();
  return items;
}

/** The hour a click `offsetY` pixels down a day column lands on, as "09:00"; the grid draws `hourPx` pixels an hour. */
export function slotTimeAt(offsetY: number, hourPx: number) {
  const hour = Math.min(23, Math.max(0, Math.floor(offsetY / hourPx)));
  return timeOfMinutes(hour * 60);
}

/**
 * Where the "now" line goes: the local day and minute of `now`. The line is drawn only in
 * the column of `date`, when that's today.
 */
export function nowPosition(now: Date, timeZone: string) {
  const local = utcToZoned(now, timeZone);
  return { date: local.date, minute: minutesOfTime(local.time) };
}
