import { addDays, addMonths, daysInMonth, isValidDate, toIsoDate } from "@/lib/calendar";
import { DEFAULT_EVENT_TIMEZONE } from "@/lib/family-calendar/types";
import { zonedTimeToUtc } from "@/lib/time-zone";

/**
 * What the calendar page shows and where: the view, the date it is anchored on, and the range of
 * days (and instants) each view needs. Pure, so the page, its prefetching and the tests share it.
 * Dates are `YYYY-MM-DD` on the Europe/Bucharest calendar; weeks start on Monday.
 */

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = { month: "Month", week: "Week", agenda: "Agenda" };

export const DEFAULT_CALENDAR_VIEW: CalendarView = "month";

/** The query parameters the page keeps its state in: `?view=` and `?date=`. */
export const CALENDAR_VIEW_PARAM = "view";
export const CALENDAR_DATE_PARAM = "date";

/** The month grid always shows six weeks, so its height doesn't jump from month to month. */
export const MONTH_GRID_WEEKS = 6;
export const MONTH_GRID_DAYS = MONTH_GRID_WEEKS * 7;

/** The Agenda opens on this many days, and "Load more" adds `AGENDA_MORE_DAYS` (a request covers at most 92). */
export const AGENDA_DAYS = 60;
export const AGENDA_MORE_DAYS = 30;

export type CalendarState = { view: CalendarView; date: string };

/** A range of local days: `start` included, `endExclusive` excluded. */
export type DateRange = { start: string; endExclusive: string };

export function isCalendarView(value: string | null | undefined): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value ?? "");
}

/** The view and date in a page URL; a missing or invalid view is Month and a missing or invalid date is `today`. */
export function parseCalendarParams(params: { get(name: string): string | null }, today: string): CalendarState {
  const view = params.get(CALENDAR_VIEW_PARAM);
  const date = params.get(CALENDAR_DATE_PARAM)?.trim() ?? "";
  return {
    view: isCalendarView(view) ? view : DEFAULT_CALENDAR_VIEW,
    date: isValidDate(date) ? date : today,
  };
}

/** The page URL for `state`, keeping other query parameters; the defaults (Month, today) leave the URL clean. */
export function calendarHref(pathname: string, current: { toString(): string }, state: CalendarState, today: string) {
  const params = new URLSearchParams(current.toString());
  if (state.view === DEFAULT_CALENDAR_VIEW) params.delete(CALENDAR_VIEW_PARAM);
  else params.set(CALENDAR_VIEW_PARAM, state.view);
  if (state.date === today) params.delete(CALENDAR_DATE_PARAM);
  else params.set(CALENDAR_DATE_PARAM, state.date);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** 0 for Monday … 6 for Sunday. */
export function weekdayIndex(date: string) {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** The Monday on or before `date`. */
export function startOfWeek(date: string) {
  return addDays(date, -weekdayIndex(date));
}

/** The seven dates of the week `date` falls in, Monday first. */
export function weekDays(date: string) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/** The first day of the month grid for `date`'s month: the Monday on or before the 1st. */
export function monthGridStart(date: string) {
  return startOfWeek(`${date.slice(0, 7)}-01`);
}

/** The 42 dates of the month grid for `date`'s month, Monday first, in rows of seven. */
export function monthGridDays(date: string) {
  const start = monthGridStart(date);
  return Array.from({ length: MONTH_GRID_DAYS }, (_, index) => addDays(start, index));
}

/** The grid's rows: six weeks of seven dates. */
export function monthGridWeeks(date: string) {
  const days = monthGridDays(date);
  return Array.from({ length: MONTH_GRID_WEEKS }, (_, index) => days.slice(index * 7, index * 7 + 7));
}

/** The days a view needs events for: the month grid, the week, or the Agenda's first `agendaDays` days. */
export function viewRange(view: CalendarView, date: string, agendaDays = AGENDA_DAYS): DateRange {
  if (view === "month") {
    const start = monthGridStart(date);
    return { start, endExclusive: addDays(start, MONTH_GRID_DAYS) };
  }
  if (view === "week") {
    const start = startOfWeek(date);
    return { start, endExclusive: addDays(start, 7) };
  }
  return { start: date, endExclusive: addDays(date, agendaDays) };
}

/** `range` as the instants the API takes: local midnight to local midnight, as ISO timestamps. */
export function rangeInstants(range: DateRange, timeZone = DEFAULT_EVENT_TIMEZONE) {
  return {
    from: zonedTimeToUtc(range.start, "00:00", timeZone).toISOString(),
    to: zonedTimeToUtc(range.endExclusive, "00:00", timeZone).toISOString(),
  };
}

/** The date Previous (-1) or Next (1) moves to: a month, a week, or an Agenda window. A month keeps the day where it can. */
export function shiftCalendarDate(view: CalendarView, date: string, direction: -1 | 1) {
  if (view === "week") return addDays(date, 7 * direction);
  if (view === "agenda") return addDays(date, AGENDA_DAYS * direction);
  const month = addMonths(date.slice(0, 7), direction);
  return toIsoDate(Number(month.slice(0, 4)), Number(month.slice(5)), Math.min(Number(date.slice(8)), daysInMonth(month)));
}

/** The ranges Previous and Next lead to, which the page fetches ahead of time. */
export function neighbourRanges(view: CalendarView, date: string): [DateRange, DateRange] {
  return [viewRange(view, shiftCalendarDate(view, date, -1)), viewRange(view, shiftCalendarDate(view, date, 1))];
}

function shortDate(date: string, withYear: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Oct 26 – Nov 1, 2026", or "Dec 28, 2026 – Jan 3, 2027" across a year. */
function spanTitle(first: string, last: string) {
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${shortDate(first, false)} – ${shortDate(last, true)}`
    : `${shortDate(first, true)} – ${shortDate(last, true)}`;
}

/**
 * The header's title: "October 2026" for a month, "Oct 26 – Nov 1, 2026" for a week, and for the
 * Agenda "Next 60 days" from `today` or the window's dates from any other day.
 */
export function periodTitle(view: CalendarView, date: string, today: string, agendaDays = AGENDA_DAYS) {
  if (view === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${date.slice(0, 7)}-01T12:00:00Z`));
  }
  if (view === "week") return spanTitle(startOfWeek(date), addDays(startOfWeek(date), 6));
  return date === today ? `Next ${agendaDays} days` : spanTitle(date, addDays(date, agendaDays - 1));
}

/** "Wed 4 Nov", for a day's heading. */
export function dayHeading(date: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .formatToParts(new Date(`${date}T12:00:00Z`));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "Wednesday 4 November 2026", for labels read out loud. */
export function longDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`)).replace(",", "");
}
