import { calendarHref, parseCalendarParams, type CalendarView, DEFAULT_CALENDAR_VIEW } from "@/lib/family-calendar/view";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { utcToZoned } from "@/lib/time-zone";

/**
 * `/calendar?event=<id>`, where an event notification leads: the page opens that event. Pure helpers
 * for what the page does with the parameter (the effect itself is in `calendar-screen.tsx`).
 */

/** The query parameter that names the event to open. */
export const CALENDAR_EVENT_PARAM = "event";

/** What the page says when the linked event can't be opened (deleted since, or not the family's). */
export const LINKED_EVENT_MISSING_MESSAGE = "That event no longer exists, or isn't on your family's calendar.";

/** The calendar URL without `?event=`, keeping the view, date, member filter and any other parameter. */
export function withoutEventHref(pathname: string, current: { toString(): string }) {
  const params = new URLSearchParams(current.toString());
  params.delete(CALENDAR_EVENT_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * The URL after opening `event`: `?event=` dropped and `?date=` moved to the day the event starts
 * on, on its own wall clock, so the view shows it behind the dialog. The view and the member filter
 * stay as they were.
 */
export function linkedEventHref(
  pathname: string,
  current: { toString(): string },
  event: Pick<CalendarEvent, "startsAt" | "timezone">,
  today: string,
  defaultView: CalendarView = DEFAULT_CALENDAR_VIEW,
) {
  const without = new URLSearchParams(withoutEventHref(pathname, current).split("?")[1] ?? "");
  const { view } = parseCalendarParams(without, today, defaultView);
  const date = utcToZoned(new Date(event.startsAt), event.timezone).date;
  return calendarHref(pathname, without, { view, date }, today, defaultView);
}

/**
 * Loads the event `?event=` names with `fetchEvent` (`GET /api/calendar/events/<id>`). Null when it
 * can't be had: a deleted event, another family's, an id that isn't one, or a failed request. The
 * page then says {@link LINKED_EVENT_MISSING_MESSAGE} rather than showing an error.
 */
export async function loadLinkedEvent(
  id: string,
  fetchEvent: (id: string) => Promise<CalendarEvent>,
): Promise<CalendarEvent | null> {
  try {
    return await fetchEvent(id);
  } catch {
    return null;
  }
}
