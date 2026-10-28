import { addDays } from "@/lib/calendar";
import { compareEvents, eventDays } from "@/lib/family-calendar/days";
import type { CalendarEvent } from "@/lib/family-calendar/types";

/** How many event chips a day shows in the month grid before "+N more". */
export const MONTH_MAX_LANES = 3;

/** An event's stretch of days within one week row of the month grid. */
export type WeekSegment = {
  event: CalendarEvent;
  /** The first day's column in the week, 0 for Monday. */
  column: number;
  /** How many columns it spans, 1 to 7. */
  span: number;
  /** The row it sits in, counted from 0 at the top of the week's chips. */
  lane: number;
  /** The event began in an earlier week: its left edge is open. */
  startsBeforeWeek: boolean;
  /** The event goes on into a later week: its right edge is open. */
  endsAfterWeek: boolean;
};

export type MonthWeekLayout = {
  /** The segments that fit in the lanes, in drawing order. */
  segments: WeekSegment[];
  /** For each of the week's seven days, how many events didn't fit and are behind "+N more". */
  moreByDay: number[];
  /** How many lanes the visible segments use, 0 to `maxLanes`. */
  laneCount: number;
};

/**
 * Lays the events that touch the week starting on `weekStart` (a Monday) into lanes. Each event
 * becomes one segment spanning the days it covers within the week; a segment takes the first lane
 * that is free on all its days, so a multi-day event keeps one row across the week. Segments that
 * would need a lane at or past `maxLanes` aren't drawn: each of their days counts them in
 * `moreByDay`. Events are placed by their first day in the week, longest first, then in
 * `compareEvents` order, so the layout doesn't depend on the order they arrive in.
 */
export function layoutMonthWeek(
  events: readonly CalendarEvent[],
  weekStart: string,
  maxLanes = MONTH_MAX_LANES,
): MonthWeekLayout {
  const weekEnd = addDays(weekStart, 6);
  const columnOf = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);

  const candidates = events.flatMap((event) => {
    const days = eventDays(event);
    if (days.last < weekStart || days.first > weekEnd) return [];
    const column = columnOf(days.first < weekStart ? weekStart : days.first);
    const lastColumn = columnOf(days.last > weekEnd ? weekEnd : days.last);
    return [{
      event,
      column,
      span: lastColumn - column + 1,
      startsBeforeWeek: days.first < weekStart,
      endsAfterWeek: days.last > weekEnd,
    }];
  }).sort((a, b) => a.column - b.column || b.span - a.span || compareEvents(a.event, b.event));

  // `busy[lane]` holds the columns each lane is already using.
  const busy: boolean[][] = [];
  const segments: WeekSegment[] = [];
  const moreByDay = Array.from({ length: 7 }, () => 0);

  for (const candidate of candidates) {
    const columns = Array.from({ length: candidate.span }, (_, index) => candidate.column + index);
    let lane = 0;
    while (busy[lane]?.some((used, column) => used && columns.includes(column))) lane += 1;

    if (lane >= maxLanes) {
      for (const column of columns) moreByDay[column] += 1;
      continue;
    }
    busy[lane] ??= [];
    for (const column of columns) busy[lane][column] = true;
    segments.push({ ...candidate, lane });
  }

  return {
    segments,
    moreByDay,
    laneCount: segments.reduce((most, segment) => Math.max(most, segment.lane + 1), 0),
  };
}
