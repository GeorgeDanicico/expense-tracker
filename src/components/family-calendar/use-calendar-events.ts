"use client";

import { useCallback, useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useCalendarApi } from "@/components/family-calendar/calendar-api";
import { ApiError } from "@/lib/api/client";
import { calendarEventsApiKey, isCalendarEventsKey, type CalendarEventsResponse } from "@/lib/api/keys";
import type { FamilyMember } from "@/lib/family/repository";
import { withEditedEvent, withoutEvents, withPendingEvents } from "@/lib/family-calendar/optimistic";
import type { CalendarAttendee, CalendarEvent, EditScope } from "@/lib/family-calendar/types";
import { rangeInstants, type DateRange } from "@/lib/family-calendar/view";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

/** How often a shown range refetches while the tab is visible (SWR skips hidden tabs). */
export const CALENDAR_REFRESH_MS = 60_000;

const noRetryOn = (caught: unknown) => !(caught instanceof ApiError && [401, 403, 404].includes(caught.status));

/** The SWR key for `range`, or null while the calendar is disabled (no family). */
export function rangeKey(range: DateRange, enabled = true, member?: string | null) {
  if (!enabled) return null;
  const { from, to } = rangeInstants(range);
  return calendarEventsApiKey(from, to, member);
}

/**
 * The events overlapping `range`, from `GET /api/calendar/events`: revalidated when the window
 * gets focus and every minute while visible. Pass `enabled: false` for a user without a family, so
 * nothing is fetched. `noFamily` is true when the server answered 404.
 */
export function useCalendarRange(range: DateRange, { enabled = true, member }: { enabled?: boolean; member?: string | null } = {}) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<CalendarEventsResponse>(rangeKey(range, enabled, member), {
    revalidateOnFocus: true,
    refreshInterval: (latest) => (latest ? CALENDAR_REFRESH_MS : 0),
    shouldRetryOnError: noRetryOn,
  });
  return useMemo(() => ({
    events: data?.events,
    error: error as unknown,
    isLoading,
    isValidating,
    noFamily: error instanceof ApiError && error.status === 404,
    refresh: () => void mutate(),
  }), [data, error, isLoading, isValidating, mutate]);
}

/**
 * Fetches `ranges` (the ones Previous and Next lead to) into the cache without showing them, so
 * moving there is instant. They don't poll or refetch on focus; a shown range does that once it is
 * opened, and every write refetches all of them.
 */
export function usePrefetchRanges(ranges: readonly [DateRange, DateRange], { enabled = true, member }: { enabled?: boolean; member?: string | null } = {}) {
  const passive = { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false } as const;
  useSWR<CalendarEventsResponse>(rangeKey(ranges[0], enabled, member), passive);
  useSWR<CalendarEventsResponse>(rangeKey(ranges[1], enabled, member), passive);
}

/**
 * The calendar's writes, optimistic: each one first changes every range the page has cached (see
 * `optimistic.ts`), then asks the API, then refetches the ranges so the server's rows replace the
 * guesses. If the API refuses, every range goes back to what it held and the error is thrown for
 * the form to show.
 */
export function useCalendarWrites(members: readonly FamilyMember[]) {
  const api = useCalendarApi();
  const { mutate, cache } = useSWRConfig();

  const attendeesOf = useCallback((memberIds: readonly string[]): CalendarAttendee[] => memberIds.flatMap((memberId) => {
    const member = members.find((candidate) => candidate.memberId === memberId);
    return member ? [{ memberId, name: member.displayName ?? member.username, color: member.color, avatarUrl: member.avatarUrl }] : [];
  }), [members]);

  const write = useCallback(async <T,>(optimistic: (events: CalendarEvent[]) => CalendarEvent[], request: () => Promise<T>) => {
    const keys = [...cache.keys()].filter(isCalendarEventsKey);
    const before = new Map(keys.map((key) => [key, cache.get(key)?.data as CalendarEventsResponse | undefined]));
    await Promise.all(keys.map((key) => mutate(
      key,
      (current?: CalendarEventsResponse) => (current ? { events: optimistic(current.events) } : current),
      { revalidate: false },
    )));
    try {
      const result = await request();
      void mutate(isCalendarEventsKey);
      return result;
    } catch (caught) {
      await Promise.all(keys.map((key) => mutate(key, before.get(key), { revalidate: false })));
      void mutate(isCalendarEventsKey);
      throw caught;
    }
  }, [cache, mutate]);

  return useMemo(() => ({
    /** Adds the event (and a repeat's other occurrences). */
    create: (input: CalendarEventInput) => write(
      (events) => withPendingEvents(events, input, attendeesOf(input.attendeeMemberIds), null),
      () => api.create(input),
    ),
    /** Edits the event `id` and, by `edit.scope`, the occurrences after it or the whole series. */
    update: (id: string, edit: CalendarEventEdit) => write(
      (events) => withEditedEvent(events, id, edit, edit.attendeeMemberIds ? attendeesOf(edit.attendeeMemberIds) : undefined),
      () => api.update(id, edit),
    ),
    /** Deletes the event `id` and, by `scope`, the occurrences after it or the whole series. */
    remove: (id: string, scope: EditScope) => write(
      (events) => withoutEvents(events, id, scope),
      () => api.remove(id, scope),
    ),
  }), [api, attendeesOf, write]);
}

export type CalendarWrites = ReturnType<typeof useCalendarWrites>;
