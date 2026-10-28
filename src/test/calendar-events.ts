import { seriesRows } from "@/lib/family-calendar/series";
import type { CalendarAttendee, CalendarEvent, SeriesRepeat } from "@/lib/family-calendar/types";

// Calendar events for the page's tests: a timed or all-day event, or a whole series, in the
// Europe/Bucharest time zone, with ids and attendees that read well in a failure.

export const ANA: CalendarAttendee = { memberId: "m-ana", name: "Ana", color: 2, avatarUrl: null };
export const DAN: CalendarAttendee = { memberId: "m-dan", name: "Dan", color: 1, avatarUrl: null };
export const LUCA: CalendarAttendee = { memberId: "m-luca", name: "Luca", color: null, avatarUrl: null };

/** The colour tokens `useMemberColors` would give these members. */
export const COLORS: Record<string, string> = { "m-ana": "member.2", "m-dan": "member.1", "m-luca": "member.3" };
export const colorOf = (memberId: string | null | undefined) => (memberId ? COLORS[memberId] : undefined);

type EventOptions = {
  id?: string;
  title?: string;
  /** Local `YYYY-MM-DD HH:MM`, or for an all-day event `YYYY-MM-DD`. */
  start: string;
  /** Local end, same format; an all-day event's last day (included). Defaults to an hour later / the start day. */
  end?: string;
  attendees?: CalendarAttendee[];
  location?: string;
};

function timing({ start, end }: Pick<EventOptions, "start" | "end">) {
  const allDay = !start.includes(" ");
  const [startDate, startTime = null] = start.split(" ");
  const [endDate = startDate, endTime = null] = (end ?? "").split(" ");
  return {
    allDay,
    startDate,
    startTime,
    endDate: end ? endDate : startDate,
    endTime: allDay ? null : endTime ?? `${String(Number(startTime!.slice(0, 2)) + 1).padStart(2, "0")}:${startTime!.slice(3)}`,
  };
}

/** One event, or the occurrences of a repeat as separate events, as the API lists them. */
export function calendarEvents(options: EventOptions & { repeat?: { kind: SeriesRepeat; count: number } }): CalendarEvent[] {
  const when = timing(options);
  const repeat = options.repeat ?? { kind: "none" as const, count: 1 };
  const id = options.id ?? "e1";
  return seriesRows({ ...when, endDate: when.endDate, repeat }, "Europe/Bucharest").map((row) => ({
    id: repeat.kind === "none" ? id : `${id}-${row.seriesIndex}`,
    seriesId: `series-${id}`,
    seriesIndex: row.seriesIndex,
    seriesLength: repeat.kind === "none" ? 1 : repeat.count,
    seriesRepeat: repeat.kind,
    title: options.title ?? "Swimming",
    notes: "",
    location: options.location ?? "",
    allDay: when.allDay,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: "Europe/Bucharest",
    attendees: options.attendees ?? [ANA],
    createdBy: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  }));
}

export const calendarEvent = (options: EventOptions) => calendarEvents(options)[0];
