import { DomainError } from "@/lib/errors";
import type { FamilyMember } from "@/lib/family/repository";
import type { CalendarAttendee, CalendarEvent, SeriesRepeat } from "@/lib/family-calendar/types";

/** What a caller without a family gets from the methods that need one (routes check membership first). */
export const NO_FAMILY_MESSAGE = "Join a family to use the calendar.";

/** The message for an attendee who isn't a member of the caller's family (the attendee guard trigger's check). */
export const ATTENDEE_OUTSIDE_FAMILY_MESSAGE = "An event can only be for members of its family.";

/** The message for an edit of an event that is gone or isn't the caller's family's (`update_calendar_events`' P0002). */
export const EVENT_GONE_MESSAGE = "That event wasn't found.";

/** A 404 for a caller without a family. */
export function noFamilyError(): DomainError {
  return new DomainError(NO_FAMILY_MESSAGE, 404);
}

/** A 422 for an attendee outside the caller's family, pointing at the `attendeeMemberIds` field. */
export function attendeeOutsideFamilyError(): DomainError {
  return new DomainError(ATTENDEE_OUTSIDE_FAMILY_MESSAGE, 422, {
    attendeeMemberIds: [ATTENDEE_OUTSIDE_FAMILY_MESSAGE],
  });
}

/** A 404 for an edit of an event that no longer exists in the caller's family. */
export function eventGoneError(): DomainError {
  return new DomainError(EVENT_GONE_MESSAGE, 404);
}

/**
 * The attendee's display fields, from the family's member list (`getFamily()`), so a whole range
 * needs one family read rather than one per event. A member missing from the list (it can't be, as
 * the database removes an attendee with its member) still shows, without a name.
 */
export function calendarAttendee(members: readonly FamilyMember[], memberId: string): CalendarAttendee {
  const member = members.find((candidate) => candidate.memberId === memberId);
  return {
    memberId,
    name: member?.displayName ?? null,
    color: member?.color ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

/**
 * The attendees of an event as `CalendarEvent` lists them: in the order the family lists its members
 * (a stable order, whichever order the rows came in), a member the list doesn't know last.
 */
export function calendarAttendees(members: readonly FamilyMember[], memberIds: readonly string[]): CalendarAttendee[] {
  const rank = (memberId: string) => {
    const index = members.findIndex((member) => member.memberId === memberId);
    return index < 0 ? members.length : index;
  };
  return [...new Set(memberIds)]
    .toSorted((a, b) => rank(a) - rank(b))
    .map((memberId) => calendarAttendee(members, memberId));
}

/**
 * One occurrence to insert, as the service works it out (`series.ts` for the times, `notify.ts` for
 * `notifyAt`). Instants are ISO strings. A series' rows share one generated series id, so there is
 * none here: give every row of a series the same `seriesRepeat` and a `seriesIndex` from 1.
 */
export type NewCalendarRow = {
  seriesIndex: number;
  seriesRepeat: SeriesRepeat;
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  timezone: string;
  /** When the worker notifies the attendees; null for none. */
  notifyAt: string | null;
};

/**
 * The new values of one stored occurrence: its `id` and the fields to change. A field that is absent
 * keeps its value; `notifyAt` and `notifiedAt` may be null, which clears them. The family, creator,
 * series and repeat never change.
 */
export type CalendarRowEdit = {
  id: string;
  title?: string;
  notes?: string;
  location?: string;
  allDay?: boolean;
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  notifyAt?: string | null;
  notifiedAt?: string | null;
};

/**
 * The family calendar. Get it from `getRepositories().calendar`; never import an implementation.
 * Methods take no family id: they act as the signed-in caller, whose family comes from their
 * membership (RLS), never from the client. Every member can do everything on every event of their
 * family; another family's event counts as missing. Events come back as `CalendarEvent`s: their
 * attendees' display name, colour and avatar joined from the family, and `seriesLength` counted.
 *
 * Writes store what they're given: the times come from `series.ts` and `notifyAt` from `notify.ts`,
 * which `src/lib/family-calendar/service.ts` runs, so routes and MCP tools go through the service
 * rather than writing here.
 */
export interface CalendarRepository {
  /**
   * The events overlapping the half-open range from `from` to `to` (ISO instants): those that start
   * before `to` and end after `from`, by start then id. Throws a 404 `DomainError` when the caller has no family.
   */
  listBetween(from: string, to: string): Promise<CalendarEvent[]>;
  /** The event, or null when the caller's family has no such event. */
  get(id: string): Promise<CalendarEvent | null>;
  /** Every occurrence of the series, by `seriesIndex`; empty when the caller's family has no such series. */
  listSeries(seriesId: string): Promise<CalendarEvent[]>;
  /**
   * Adds the 1–10 `rows` as one series in the caller's family, created by the caller, each attending
   * `memberIds` (at least one), in one transaction, and returns them by `seriesIndex`. Throws a 422
   * `DomainError` when a member isn't in the family, and a 404 one when the caller has no family.
   */
  create(rows: readonly NewCalendarRow[], memberIds: readonly string[]): Promise<CalendarEvent[]>;
  /**
   * Changes the given rows and, when `memberIds` is given (at least one), replaces their attendees
   * with exactly those members, in one transaction. Returns the changed events by series then
   * `seriesIndex`. Throws a 404 `DomainError` (nothing changes) when any row isn't in the caller's
   * family, and a 422 one when a member isn't.
   */
  update(rows: readonly CalendarRowEdit[], memberIds?: readonly string[]): Promise<CalendarEvent[]>;
  /** Deletes the events and their attendees, returning the ids of those that existed in the caller's family. */
  delete(ids: readonly string[]): Promise<string[]>;
}
