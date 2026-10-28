import { utcToZoned, zonedTimeToUtc } from "@/lib/time-zone";

/**
 * When an event notifies its attendees (docs/calendar-plan.md, "How notification times are worked
 * out"). Pure; the API stores the result in `calendar_events.notify_at` on every save.
 */

const MINUTE = 60_000;

/** A timed event notifies this many minutes before it starts. */
export const EVENT_LEAD_MINUTES = 30;
/** An all-day event notifies at this local time on its first day. */
export const ALL_DAY_NOTIFY_TIME = "07:30";

/**
 * The instant to notify for `event`: 30 minutes before a timed event (an elapsed time, so 04:00 on
 * the spring change day notifies at 02:30 local), or 07:30 local on the first day of an all-day
 * event. Null when that time is not after `now`: an event saved too late doesn't notify.
 */
export function notifyAt(
  event: { startsAt: string; allDay: boolean; timezone: string },
  now: Date,
): Date | null {
  const startsAt = new Date(event.startsAt);
  const time = event.allDay
    ? zonedTimeToUtc(utcToZoned(startsAt, event.timezone).date, ALL_DAY_NOTIFY_TIME, event.timezone)
    : new Date(startsAt.getTime() - EVENT_LEAD_MINUTES * MINUTE);
  return time.getTime() > now.getTime() ? time : null;
}
