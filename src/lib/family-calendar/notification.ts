import { SERIES_REPEATS, type SeriesRepeat } from "@/lib/family-calendar/types";
import { formatDay } from "@/lib/reminders/format";
import { utcToZoned } from "@/lib/time-zone";

// What the worker queues for a due event and how it words an "added you" row (docs/calendar-plan.md,
// "C7: Event notifications"). Pure, so it's tested directly with a fixed `now`.

const MINUTE = 60_000;

/** The event fields a notification is worked out from. Instants are `Date`s. */
export type NotifiableEvent = {
  id: string;
  title: string;
  allDay: boolean;
  startsAt: Date;
  timezone: string;
};

/** The push payload of an event notification, as stored in `notifications.payload`. */
export type EventPayload = { title: string; body: string; url: string; tag: string };

/** The page the notification opens: the calendar, with this event open. */
export function eventUrl(id: string) {
  return `/calendar?event=${encodeURIComponent(id)}`;
}

/**
 * The outbox key of one notify time for one attendee: a re-run (or a second worker) queues it only
 * once, while an event moved to a new time, which has a new `notify_at`, queues again.
 */
export function eventDedupeKey(id: string, notifyAt: Date, userId: string) {
  return `event:${id}:${notifyAt.toISOString()}:${userId}`;
}

/** How long until a start, "in 30 minutes", "in 1 hour 5 minutes"; "starting now" or "started 5 minutes ago". */
function startsIn(startsAt: Date, now: Date) {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / MINUTE);
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;
  if (minutes < 0) return `started ${plural(-minutes, "minute")} ago`;
  if (minutes === 0) return "starting now";
  if (minutes < 60) return `in ${plural(minutes, "minute")}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `in ${plural(hours, "hour")}${rest > 0 ? ` ${plural(rest, "minute")}` : ""}`;
}

/**
 * The body of the notification sent at `now`: "At 18:00, in 30 minutes" for a timed event (the
 * start on the wall clock of the event's zone, the distance measured from `now`, so a worker that
 * ran late says "in 10 minutes", not 30), "Today, all day" for an all-day one.
 */
export function eventBody(event: Pick<NotifiableEvent, "allDay" | "startsAt" | "timezone">, now: Date) {
  if (event.allDay) return "Today, all day";
  return `At ${utcToZoned(event.startsAt, event.timezone).time}, ${startsIn(event.startsAt, now)}`;
}

/** The payload for a notification queued at `now`: the event's title, when it starts, the way to open it. */
export function eventPayload(event: NotifiableEvent, now: Date): EventPayload {
  return { title: event.title, body: eventBody(event, now), url: eventUrl(event.id), tag: `event:${event.id}` };
}

/**
 * The body of an "added you" notification: the event's title and first day, "Visit my parents,
 * Sat 1 Nov", and for a repeat how long it goes on, "Swimming, Tue 3 Nov, every week for 6 weeks".
 * A series of one (or a repeat this code doesn't know) is worded as a one-off.
 */
export function eventAddedBody(
  event: { title: string; startsAt: Date; timezone: string; seriesRepeat: string; seriesLength: number },
  now: Date,
) {
  const day = formatDay(utcToZoned(event.startsAt, event.timezone).date, now);
  const base = `${event.title}, ${day}`;
  const repeat = SERIES_REPEATS.includes(event.seriesRepeat as SeriesRepeat) ? (event.seriesRepeat as SeriesRepeat) : "none";
  if (repeat === "none" || event.seriesLength < 2) return base;
  return repeat === "daily"
    ? `${base}, every day for ${event.seriesLength} days`
    : `${base}, every week for ${event.seriesLength} weeks`;
}

/**
 * The `{ title, body, url, tag }` to send for an `event_added` row: the trigger's own title, url and
 * tag with the body worded by {@link eventAddedBody} from the payload's `eventTitle`, `startsAt`,
 * `timezone`, `seriesRepeat` and `seriesLength`. Null when those aren't all usable, in which case
 * the trigger's own `body` (the event's title) is sent as it is.
 */
export function eventAddedPayload(payload: unknown, now: Date): EventPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { title, url, tag, eventTitle, startsAt, timezone, seriesRepeat, seriesLength } = payload as Record<string, unknown>;
  if (typeof title !== "string" || !title || typeof url !== "string" || typeof tag !== "string") return null;
  if (typeof eventTitle !== "string" || typeof startsAt !== "string" || typeof timezone !== "string") return null;
  if (typeof seriesRepeat !== "string" || typeof seriesLength !== "number") return null;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return null;
  try {
    return { title, body: eventAddedBody({ title: eventTitle, startsAt: start, timezone, seriesRepeat, seriesLength }, now), url, tag };
  } catch {
    // An unknown time zone: send the trigger's own text.
    return null;
  }
}
