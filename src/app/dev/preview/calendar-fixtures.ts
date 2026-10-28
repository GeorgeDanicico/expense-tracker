import type { CalendarApi } from "@/components/family-calendar/calendar-api";
import { ApiError } from "@/lib/api/client";
import { addDays, getBucharestToday } from "@/lib/calendar";
import { editedRows, seriesRows, type StoredRow } from "@/lib/family-calendar/series";
import {
  DEFAULT_EVENT_TIMEZONE,
  type CalendarAttendee,
  type CalendarEvent,
  type EditScope,
  type SeriesRepeat,
} from "@/lib/family-calendar/types";
import { startOfWeek } from "@/lib/family-calendar/view";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

// The family calendar for `/dev/preview/calendar`: sample events kept in memory around today, and a
// fake API that changes them the way the real routes do (the same `seriesRows` and `editedRows` the
// service uses, so a repeat, a moved occurrence and "this and following" land on the right days),
// so adding, editing and deleting work without a session. Open `/dev/preview/calendar?failWrites=1`
// to have every write refused, which shows the rollback.

const MEMBERS: Record<string, CalendarAttendee> = {
  "m-george": { memberId: "m-george", name: "George", color: null, avatarUrl: null },
  "m-maria": { memberId: "m-maria", name: "Maria", color: 6, avatarUrl: "/apple-icon.png" },
  "m-ana": { memberId: "m-ana", name: "Ana", color: null, avatarUrl: null },
  "m-luca": { memberId: "m-luca", name: "Luca", color: null, avatarUrl: null },
};

const attendeesOf = (ids: readonly string[]) => ids.flatMap((id) => (MEMBERS[id] ? [MEMBERS[id]] : []));

type Sample = {
  title: string;
  /** Days from the Monday of this week. */
  day: number;
  time?: string;
  /** Last day, as days from the Monday of this week (all-day and multi-day events). */
  endDay?: number;
  endTime?: string;
  going: string[];
  location?: string;
  notes?: string;
  repeat?: { kind: SeriesRepeat; count: number };
};

const EVERYONE = Object.keys(MEMBERS);

const SAMPLES: Sample[] = [
  { title: "Swimming", day: 1 - 14, time: "18:00", endTime: "19:00", going: ["m-luca"], location: "Olympic pool", repeat: { kind: "weekly", count: 6 } },
  { title: "Piano lesson", day: 3 - 14, time: "16:30", endTime: "17:30", going: ["m-ana"], repeat: { kind: "weekly", count: 8 } },
  { title: "Dentist", day: 1, time: "10:00", endTime: "11:00", going: ["m-maria"], location: "Dr. Ionescu", notes: "Bring the insurance card." },
  { title: "Parent-teacher meeting", day: 2, time: "17:30", endTime: "18:30", going: ["m-george", "m-maria"], location: "Ana's school" },
  { title: "School concert", day: 3, time: "09:00", endTime: "10:30", going: ["m-ana"] },
  // Thursday is crowded on purpose, to show the Week view's side-by-side layout: the concert, the
  // check-up and the rehearsal overlap three ways, and the call overlaps the plumber and groceries.
  { title: "Doctor check-up", day: 3, time: "09:30", endTime: "10:30", going: ["m-maria"], location: "Clinic" },
  { title: "Piano recital rehearsal", day: 3, time: "10:00", endTime: "11:15", going: ["m-luca"] },
  { title: "Call the plumber", day: 3, time: "11:00", endTime: "11:30", going: ["m-george"] },
  { title: "Team call", day: 3, time: "11:15", endTime: "12:15", going: ["m-george"] },
  { title: "Bin day", day: 3, going: ["m-george"] },
  { title: "Library books due", day: 3, going: ["m-ana"] },
  { title: "Ski weekend", day: 5, endDay: 6, going: ["m-george", "m-luca"], location: "Poiana Brasov" },
  { title: "Groceries", day: 3, time: "12:00", endTime: "13:00", going: ["m-george"] },
  { title: "Football", day: 3, time: "15:00", endTime: "16:30", going: ["m-luca"] },
  { title: "Book club", day: 3, time: "19:00", endTime: "21:00", going: ["m-maria"] },
  { title: "Sleepover at Radu's", day: 4, time: "20:00", endDay: 5, endTime: "10:00", going: ["m-ana"] },
  { title: "Family lunch at grandma's", day: 6, time: "13:00", endTime: "16:00", going: EVERYONE, location: "Cluj" },
  { title: "Trip to Sibiu", day: 12, endDay: 15, going: ["m-george", "m-maria"], location: "Sibiu" },
  { title: "Ana's birthday", day: 17, going: EVERYONE },
];

let store: CalendarEvent[] | null = null;
let counter = 0;

type Draft = {
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
  attendeeMemberIds: string[];
  repeat: { kind: SeriesRepeat; count: number };
};

function eventsFor(input: Draft, createdAt: string): CalendarEvent[] {
  const seriesId = `series-${++counter}`;
  const length = input.repeat.kind === "none" ? 1 : input.repeat.count;
  return seriesRows(input, DEFAULT_EVENT_TIMEZONE).map((row) => ({
    id: `${seriesId}-${row.seriesIndex}`,
    seriesId,
    seriesIndex: row.seriesIndex,
    seriesLength: length,
    seriesRepeat: input.repeat.kind,
    title: input.title,
    notes: input.notes,
    location: input.location,
    allDay: input.allDay,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    timezone: DEFAULT_EVENT_TIMEZONE,
    attendees: attendeesOf(input.attendeeMemberIds),
    createdBy: "u-m-george",
    createdAt,
    updatedAt: createdAt,
  }));
}

function seed(): CalendarEvent[] {
  const monday = startOfWeek(getBucharestToday());
  const now = new Date().toISOString();
  return SAMPLES.flatMap((sample) => {
    const allDay = sample.time === undefined;
    const startDate = addDays(monday, sample.day);
    return eventsFor({
      title: sample.title,
      notes: sample.notes ?? "",
      location: sample.location ?? "",
      allDay,
      startDate,
      startTime: sample.time ?? null,
      endDate: sample.endDay === undefined ? startDate : addDays(monday, sample.endDay),
      endTime: sample.endTime ?? null,
      attendeeMemberIds: sample.going,
      repeat: sample.repeat ?? { kind: "none", count: 1 },
    }, now);
  });
}

function events(): CalendarEvent[] {
  store ??= seed();
  return store;
}

/** `GET /api/calendar/events?from=&to=` in the preview: the events overlapping the range, by start. */
export function previewCalendarEvents(query: URLSearchParams): { events: CalendarEvent[] } {
  const from = Date.parse(query.get("from") ?? "");
  const to = Date.parse(query.get("to") ?? "");
  const member = query.get("member");
  return {
    events: events()
      .filter((event) => Date.parse(event.startsAt) < to && Date.parse(event.endsAt) > from)
      .filter((event) => !member || event.attendees.some((attendee) => attendee.memberId === member))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title)),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function begin() {
  await delay(500);
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("failWrites")) {
    throw new ApiError("The calendar could not be saved. Try again.", 500);
  }
}

function find(id: string) {
  const event = events().find((item) => item.id === id);
  if (!event) throw new ApiError("Event not found.", 404);
  return event;
}

/** The occurrences `scope` reaches from `anchor`, as the service picks them. */
function inScope(anchor: CalendarEvent, scope: EditScope) {
  return events()
    .filter((event) => event.id === anchor.id
      || (scope !== "this" && event.seriesId === anchor.seriesId && (scope === "all" || event.seriesIndex >= anchor.seriesIndex)))
    .sort((a, b) => a.seriesIndex - b.seriesIndex);
}

export const previewCalendarApi: CalendarApi = {
  async get(id: string) {
    await delay(200);
    return find(id);
  },
  async create(input: CalendarEventInput) {
    await begin();
    const created = eventsFor({ ...input, endDate: input.endDate }, new Date().toISOString());
    store = [...events(), ...created];
    return created;
  },
  async update(id: string, edit: CalendarEventEdit) {
    await begin();
    const anchor = find(id);
    const reached = inScope(anchor, edit.scope);
    const stored = (event: CalendarEvent): StoredRow => ({
      id: event.id, seriesIndex: event.seriesIndex, startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay,
    });
    const timing = new Map(editedRows(reached.map(stored), edit, anchor.timezone, id).map((row) => [row.id, row]));
    const now = new Date().toISOString();
    const changed = reached.map((event): CalendarEvent => {
      const next = timing.get(event.id)!;
      return {
        ...event,
        ...(edit.title !== undefined ? { title: edit.title } : {}),
        ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
        ...(edit.location !== undefined ? { location: edit.location } : {}),
        ...(edit.attendeeMemberIds ? { attendees: attendeesOf(edit.attendeeMemberIds) } : {}),
        allDay: next.allDay,
        startsAt: next.startsAt.toISOString(),
        endsAt: next.endsAt.toISOString(),
        updatedAt: now,
      };
    });
    store = events().map((event) => changed.find((item) => item.id === event.id) ?? event);
    return changed;
  },
  async remove(id: string, scope: EditScope) {
    await begin();
    const ids = inScope(find(id), scope).map((event) => event.id);
    const anchor = find(id);
    store = events()
      .filter((event) => !ids.includes(event.id))
      // The survivors of a series are fewer now.
      .map((event) => (event.seriesId === anchor.seriesId ? { ...event, seriesLength: event.seriesLength - ids.length } : event));
    return ids;
  },
};
