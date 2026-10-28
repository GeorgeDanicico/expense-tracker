import { addDays } from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/family-calendar/types";
import { utcToZoned } from "@/lib/time-zone";

/**
 * Which local days an event covers, and how events sort within a day. Pure; the views draw
 * from these. An all-day event's `endsAt` is local midnight after its last day, and a timed
 * event that ends at exactly midnight also stops covering the day that is just starting.
 */

const MINUTE = 60_000;

/** The first and last local day (both included) `event` covers, in its own time zone. */
export function eventDays(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "timezone">) {
  const first = utcToZoned(new Date(event.startsAt), event.timezone).date;
  const last = utcToZoned(new Date(Date.parse(event.endsAt) - MINUTE), event.timezone).date;
  return { first, last: last < first ? first : last };
}

/** How many days the event covers. */
export function eventLengthInDays(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "timezone">) {
  const { first, last } = eventDays(event);
  return Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / (24 * 60 * MINUTE)) + 1;
}

/** Whether the event covers the local day `date`. */
export function coversDay(event: Pick<CalendarEvent, "startsAt" | "endsAt" | "timezone">, date: string) {
  const { first, last } = eventDays(event);
  return first <= date && date <= last;
}

/** "09:00": the local time of an instant. */
export function localTime(instant: string, timeZone: string) {
  return utcToZoned(new Date(instant), timeZone).time;
}

/** "09:00 – 10:30" or "All day"; a timed event reaching another day names that day's end as "→ Thu 5 Nov" in the views. */
export function timeLabel(event: Pick<CalendarEvent, "allDay" | "startsAt" | "endsAt" | "timezone">) {
  if (event.allDay) return "All day";
  return `${localTime(event.startsAt, event.timezone)} – ${localTime(event.endsAt, event.timezone)}`;
}

/** The order events take within a day: those covering several days or all of it first, then by start, then title. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent) {
  return Number(b.allDay) - Number(a.allDay)
    || Number(eventLengthInDays(b) > 1) - Number(eventLengthInDays(a) > 1)
    || Date.parse(a.startsAt) - Date.parse(b.startsAt)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

/** The events covering the local day `date`, in `compareEvents` order. */
export function eventsOnDay(events: readonly CalendarEvent[], date: string) {
  return events.filter((event) => coversDay(event, date)).sort(compareEvents);
}

/** Each of `dates` with the events covering it, in order; days without events are included with an empty list. */
export function groupEventsByDay(events: readonly CalendarEvent[], dates: readonly string[]) {
  return dates.map((date) => ({ date, events: eventsOnDay(events, date) }));
}

/** The `count` consecutive dates from `start`. */
export function datesFrom(start: string, count: number) {
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

/**
 * The time to show for `event` on the day `date` it covers: "All day" (with "day 2 of 3" when it
 * spans days), "09:00 – 10:30" for a timed event within the day, "from 22:00" on its first day
 * and "until 02:00" on its last when it runs past midnight, and "All day" in between.
 */
export function dayTimeLabel(event: Pick<CalendarEvent, "allDay" | "startsAt" | "endsAt" | "timezone">, date: string) {
  const { first, last } = eventDays(event);
  if (event.allDay) {
    if (first === last) return "All day";
    const day = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000) + 1;
    return `All day · day ${day} of ${eventLengthInDays(event)}`;
  }
  if (first === last) return timeLabel(event);
  if (date === first) return `from ${localTime(event.startsAt, event.timezone)}`;
  if (date === last) return `until ${localTime(event.endsAt, event.timezone)}`;
  return "All day";
}
