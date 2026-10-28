import "server-only";

import type { Database, Json } from "@/lib/database.types";
import { DomainError } from "@/lib/errors";
import type { FamilyMember } from "@/lib/family/repository";
import {
  attendeeOutsideFamilyError,
  calendarAttendees,
  noFamilyError,
  type CalendarRepository,
  type CalendarRowEdit,
  type NewCalendarRow,
} from "@/lib/family-calendar/repository";
import { SERIES_REPEATS, type CalendarEvent, type SeriesRepeat } from "@/lib/family-calendar/types";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { supabaseFamilyRepository } from "@/lib/supabase/repositories/family";
import { createClient } from "@/lib/supabase/server";

const LOAD_ERROR = "Unable to load the calendar.";
const SAVE_ERROR = "Unable to save the event.";
const DELETE_ERROR = "Unable to delete the event.";

type EventRow = Omit<Database["public"]["Tables"]["calendar_events"]["Row"], "family_id" | "notify_at" | "notified_at" | "notify_locked_until">;
/** Embedded selects are untyped because the generated types declare no relationships. */
type EventRowWithAttendees = EventRow & { calendar_event_attendees: { member_id: string }[] | null };

const EVENT_COLUMNS =
  "id, series_id, series_index, series_repeat, title, notes, location, all_day, starts_at, ends_at, timezone, created_by, created_at, updated_at";
const WITH_ATTENDEES = `${EVENT_COLUMNS}, calendar_event_attendees(member_id)`;

/** How many series ids go in one `in` filter: they are in the URL, which has a length limit. */
const SERIES_CHUNK = 50;

function toSeriesRepeat(value: string): SeriesRepeat {
  if ((SERIES_REPEATS as readonly string[]).includes(value)) return value as SeriesRepeat;
  throw new Error(LOAD_ERROR);
}

/** An instant as a UTC ISO string, whichever way Postgres wrote it (`+00:00`, microseconds). */
const iso = (value: string) => new Date(value).toISOString();

function toEvent(
  row: EventRow,
  memberIds: readonly string[],
  members: readonly FamilyMember[],
  seriesLength: number,
): CalendarEvent {
  return {
    id: row.id,
    seriesId: row.series_id,
    seriesIndex: row.series_index,
    seriesLength,
    seriesRepeat: toSeriesRepeat(row.series_repeat),
    title: row.title,
    notes: row.notes,
    location: row.location,
    allDay: row.all_day,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    timezone: row.timezone,
    attendees: calendarAttendees(members, memberIds),
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The caller's family members, for the attendee display fields; empty without a family. */
async function familyMembers(): Promise<FamilyMember[]> {
  return (await supabaseFamilyRepository.getFamily())?.members ?? [];
}

/** A row of `create_calendar_events`' `p_rows`; only the keys the function reads. */
function newRowJson(row: NewCalendarRow): Json {
  return {
    series_index: row.seriesIndex,
    series_repeat: row.seriesRepeat,
    title: row.title,
    notes: row.notes,
    location: row.location,
    all_day: row.allDay,
    starts_at: row.startsAt,
    ends_at: row.endsAt,
    timezone: row.timezone,
    notify_at: row.notifyAt,
  };
}

/** A row of `update_calendar_events`' `p_rows`: the id and only the keys given, since an absent key keeps the value. */
function editRowJson(edit: CalendarRowEdit): Json {
  return {
    id: edit.id,
    ...(edit.title !== undefined ? { title: edit.title } : {}),
    ...(edit.notes !== undefined ? { notes: edit.notes } : {}),
    ...(edit.location !== undefined ? { location: edit.location } : {}),
    ...(edit.allDay !== undefined ? { all_day: edit.allDay } : {}),
    ...(edit.startsAt !== undefined ? { starts_at: edit.startsAt } : {}),
    ...(edit.endsAt !== undefined ? { ends_at: edit.endsAt } : {}),
    ...(edit.timezone !== undefined ? { timezone: edit.timezone } : {}),
    ...(edit.notifyAt !== undefined ? { notify_at: edit.notifyAt } : {}),
    ...(edit.notifiedAt !== undefined ? { notified_at: edit.notifiedAt } : {}),
  };
}

/**
 * A failed `create_calendar_events` or `update_calendar_events`:
 * - 23514 from the attendee guard: a member isn't in the family → a 422 with our own message. A
 *   table check (title, notes, the length of the event) also raises 23514, but its message isn't meant
 *   for users and validated input can't break one, so that stays a 500.
 * - 22023: the function's own message about its input ("Choose who the event is for.") → 422.
 * - Anything else as `translateDatabaseError` decides (42501 → 403, P0002 → 404 with the database's
 *   message, others → 500 with `fallback`).
 */
export function translateCalendarWriteError(error: { code?: string; message: string }, fallback: string): Error {
  if (error.code === "23514") {
    return /family/i.test(error.message) ? attendeeOutsideFamilyError() : new Error(fallback);
  }
  if (error.code === "22023") return new DomainError(error.message, 422);
  return translateDatabaseError(error, fallback);
}

/**
 * `CalendarRepository` on `calendar_events`, `calendar_event_attendees` and the two save functions
 * (supabase/migrations/20261028000100_create_family_calendar.sql), acting as the request's caller.
 * RLS limits every row to the caller's family, which is the only rule, so queries never filter by
 * family. Each method reads the family once through `get_family()` (in parallel with its own query)
 * to join attendee names, colours and avatars, and counts a series' length with one more query per
 * 50 repeating series: a handful of round trips per call, never one per event.
 */
export const supabaseCalendarRepository: CalendarRepository = {
  async listBetween(from, to) {
    const supabase = await createClient();
    const [family, { data, error }] = await Promise.all([
      supabaseFamilyRepository.getFamily(),
      supabase.from("calendar_events").select(WITH_ATTENDEES).lt("starts_at", to).gt("ends_at", from)
        .order("starts_at").order("id"),
    ]);
    if (!family) throw noFamilyError();
    if (error) throw new Error(LOAD_ERROR);
    return withSeriesLengths(supabase, data as unknown as EventRowWithAttendees[], family.members);
  },

  async get(id) {
    const supabase = await createClient();
    const [members, { data, error }] = await Promise.all([
      familyMembers(),
      supabase.from("calendar_events").select(WITH_ATTENDEES).eq("id", id).maybeSingle(),
    ]);
    if (error) throw new Error(LOAD_ERROR);
    if (!data) return null;
    const [event] = await withSeriesLengths(supabase, [data as unknown as EventRowWithAttendees], members);
    return event;
  },

  async listSeries(seriesId) {
    const supabase = await createClient();
    const [members, { data, error }] = await Promise.all([
      familyMembers(),
      supabase.from("calendar_events").select(WITH_ATTENDEES).eq("series_id", seriesId).order("series_index"),
    ]);
    if (error) throw new Error(LOAD_ERROR);
    const rows = data as unknown as EventRowWithAttendees[];
    return rows.map((row) => toEvent(row, attendeeIds(row), members, rows.length));
  },

  async create(rows, memberIds) {
    const family = await supabaseFamilyRepository.getFamily();
    if (!family) throw noFamilyError();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_calendar_events", {
      p_rows: rows.map(newRowJson),
      p_member_ids: [...memberIds],
    });
    if (error) throw translateCalendarWriteError(error, SAVE_ERROR);
    return data.map((row) => toEvent(row, memberIds, family.members, data.length));
  },

  async update(rows, memberIds) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("update_calendar_events", {
      p_rows: rows.map(editRowJson),
      p_member_ids: memberIds === undefined ? null : [...memberIds],
    });
    if (error) throw translateCalendarWriteError(error, SAVE_ERROR);

    // The function returns the rows without their attendees, so read them with the attendees joined.
    const [members, { data: events, error: readError }] = await Promise.all([
      familyMembers(),
      supabase.from("calendar_events").select(WITH_ATTENDEES).in("id", data.map((row) => row.id))
        .order("series_id").order("series_index"),
    ]);
    if (readError) throw new Error(SAVE_ERROR);
    return withSeriesLengths(supabase, events as unknown as EventRowWithAttendees[], members);
  },

  async delete(ids) {
    if (ids.length === 0) return [];
    const supabase = await createClient();
    const { data, error } = await supabase.from("calendar_events").delete().in("id", [...ids]).select("id");
    if (error) throw new Error(DELETE_ERROR);
    return data.map((row) => row.id);
  },
};

function attendeeIds(row: EventRowWithAttendees): string[] {
  return (row.calendar_event_attendees ?? []).map((attendee) => attendee.member_id);
}

/**
 * The rows as events. A repeat's `seriesLength` is how many rows its series has, counted in one
 * query per `SERIES_CHUNK` series; a one-off's is 1.
 */
async function withSeriesLengths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: readonly EventRowWithAttendees[],
  members: readonly FamilyMember[],
): Promise<CalendarEvent[]> {
  const repeating = [...new Set(rows.filter((row) => row.series_repeat !== "none").map((row) => row.series_id))];
  const lengths = new Map<string, number>();
  for (let start = 0; start < repeating.length; start += SERIES_CHUNK) {
    const { data, error } = await supabase.from("calendar_events").select("series_id")
      .in("series_id", repeating.slice(start, start + SERIES_CHUNK));
    if (error) throw new Error(LOAD_ERROR);
    for (const { series_id } of data) lengths.set(series_id, (lengths.get(series_id) ?? 0) + 1);
  }
  return rows.map((row) => toEvent(row, attendeeIds(row), members, lengths.get(row.series_id) ?? 1));
}
