import { APPLICATION_TIMEZONE } from "@/lib/calendar";

/** How an event repeats: a one-off, daily, or weekly on the same weekday. Stored in `series_repeat`. */
export const SERIES_REPEATS = ["none", "daily", "weekly"] as const;

export type SeriesRepeat = (typeof SERIES_REPEATS)[number];

/** A repeat has at least 2 occurrences and at most `MAX_SERIES_LENGTH`, as `series_index` checks. */
export const MIN_REPEAT_COUNT = 2;
export const MAX_SERIES_LENGTH = 10;

/**
 * Which occurrences an edit or a delete reaches: the one opened, it and every later one in its
 * series, or the whole series.
 */
export const EDIT_SCOPES = ["this", "following", "all"] as const;

export type EditScope = (typeof EDIT_SCOPES)[number];

/**
 * The longest an event may last, in days. The database allows 31 days between the two instants,
 * but a day more or less on the wall clock is an hour more or less across a clock change, so the
 * form's limit leaves that room.
 */
export const MAX_EVENT_DAYS = 30;

/** The widest range of days a list of events may cover, as the API and the service both check. */
export const MAX_RANGE_DAYS = 92;

/** The only time zone offered for now; stored per event so others can come later. */
export const DEFAULT_EVENT_TIMEZONE = APPLICATION_TIMEZONE;

/** A member attending an event, with the display fields the API joins from the family. */
export type CalendarAttendee = {
  memberId: string;
  /** The member's display name; null if none exists. */
  name: string | null;
  /** The palette slot (1..8) chosen for the member, or null for an automatic colour. */
  color: number | null;
  /** The member's picture as an `/api/avatars/…` URL, or null without one. */
  avatarUrl: string | null;
};

/**
 * An event on the family calendar, as the API returns it. A repeating event is one row per
 * occurrence, linked by `seriesId` (see "Why repeats are separate rows" in docs/calendar-plan.md).
 * Instants are ISO strings.
 */
export type CalendarEvent = {
  id: string;
  /** Shared by every occurrence of a repeat; a one-off is the only row of its own series. */
  seriesId: string;
  /** This occurrence's place in its series, 1–10. */
  seriesIndex: number;
  /** How many occurrences the series has, 1 for a one-off. */
  seriesLength: number;
  seriesRepeat: SeriesRepeat;
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  /** An all-day event starts at local midnight of its first day. */
  startsAt: string;
  /** An all-day event ends at local midnight after its last day. */
  endsAt: string;
  /** IANA time zone the event's dates and times are read in. */
  timezone: string;
  /** At least one member; an event is each attendee's own. */
  attendees: CalendarAttendee[];
  /** The user who added the event; null once that user is deleted. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};
