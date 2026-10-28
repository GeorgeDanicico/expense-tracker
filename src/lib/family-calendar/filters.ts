import { CALENDAR_EVENTS_API_KEY } from "@/lib/api/keys";
import type { CalendarEvent } from "@/lib/family-calendar/types";

/**
 * The member chips above the calendar: whose events it shows. Like the to-do board's chips, but a
 * calendar event has several attendees, so the filter is "events this member attends", and the API
 * does the filtering (`?member=` on `GET /api/calendar/events`). Pure; the screen and the tests share it.
 */

/** Everyone, the caller ("me"), or one member by member id. */
export type CalendarMemberFilter = "all" | "me" | (string & {});

export const DEFAULT_MEMBER_FILTER: CalendarMemberFilter = "all";

/** The query parameter the filter is kept in: `?member=`, `me` or a member id. */
export const CALENDAR_MEMBER_PARAM = "member";

const sameId = (a: string | null | undefined, b: string | null | undefined) => Boolean(a) && Boolean(b) && a!.toLowerCase() === b!.toLowerCase();

/**
 * The filter in a page URL. A missing or empty `?member=` is everyone. `memberIds`, once the family
 * has loaded, turns a `?member=` that names nobody in it (someone who left, a mistyped link) back
 * into everyone, so the calendar never sits empty behind a chip that isn't there; a known id comes
 * back as the family's own spelling of it.
 */
export function parseMemberFilter(
  params: { get(name: string): string | null },
  memberIds?: readonly string[],
): CalendarMemberFilter {
  const member = params.get(CALENDAR_MEMBER_PARAM)?.trim() ?? "";
  if (!member || member === "all") return DEFAULT_MEMBER_FILTER;
  if (member === "me") return "me";
  if (memberIds === undefined) return member;
  return memberIds.find((id) => sameId(id, member)) ?? DEFAULT_MEMBER_FILTER;
}

/**
 * The member id to ask the API for under `filter`: the caller's own for Me, the chosen member's
 * for a member, and null (no filter) for Everyone, or for Me without a family membership.
 */
export function memberIdFor(filter: CalendarMemberFilter, myMemberId: string | null): string | null {
  if (filter === "all") return null;
  if (filter === "me") return myMemberId;
  return filter;
}

/** Whether `filter` is on `memberId`'s chip: Me is the caller's chip, so a filter on the caller's own id is Me. */
export function isFilterOn(filter: CalendarMemberFilter, memberId: string, myMemberId: string | null) {
  if (filter === "all") return false;
  if (filter === "me") return sameId(memberId, myMemberId);
  return sameId(filter, memberId);
}

/** The page URL for `filter`, keeping every other query parameter; Everyone leaves the URL clean. */
export function memberFilterHref(pathname: string, current: { toString(): string }, filter: CalendarMemberFilter) {
  const params = new URLSearchParams(current.toString());
  if (filter === DEFAULT_MEMBER_FILTER) params.delete(CALENDAR_MEMBER_PARAM);
  else params.set(CALENDAR_MEMBER_PARAM, filter);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** The events `memberId` attends; every event when it is null. */
export function eventsAttendedBy<T extends Pick<CalendarEvent, "attendees">>(events: readonly T[], memberId: string | null | undefined): T[] {
  return memberId ? events.filter((event) => event.attendees.some((attendee) => sameId(attendee.memberId, memberId))) : [...events];
}

/** The member a cached range's SWR key is filtered to (`?member=` in `/api/calendar/events?…`), or null for an unfiltered one. */
export function memberOfKey(key: string): string | null {
  if (!key.startsWith(`${CALENDAR_EVENTS_API_KEY}?`)) return null;
  return new URLSearchParams(key.slice(CALENDAR_EVENTS_API_KEY.length + 1)).get(CALENDAR_MEMBER_PARAM);
}

/**
 * Who a new event starts with, so it doesn't vanish behind the chip it was added under: the chosen
 * member (the caller, for Me), or undefined for Everyone, which leaves the form's own default (just you).
 */
export function attendeesForNewEvent(filter: CalendarMemberFilter, myMemberId: string | null): string[] | undefined {
  const member = memberIdFor(filter, myMemberId);
  return member ? [member] : undefined;
}
