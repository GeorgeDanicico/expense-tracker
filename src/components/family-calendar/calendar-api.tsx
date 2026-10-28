"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiFetcher, apiRequest } from "@/lib/api/client";
import {
  calendarEventApiUrl,
  CALENDAR_EVENTS_API_KEY,
  CALENDAR_FEED_LINK_API_KEY,
  type CalendarDeletedResponse,
  type CalendarEventResponse,
  type CalendarEventsResponse,
  type CalendarFeedLinkResponse,
  type CreatedCalendarFeedLink,
} from "@/lib/api/keys";
import type { CalendarFeed } from "@/lib/family-calendar/feed-repository";
import type { CalendarEvent, EditScope } from "@/lib/family-calendar/types";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

/**
 * The calendar's writes. The page uses the REST API; `/dev/preview` swaps in an in-memory one.
 * `create` and `update` answer with the rows they added or changed, `remove` with the ids deleted.
 */
export type CalendarApi = {
  /** The event, for `/calendar?event=<id>`; rejects when it doesn't exist in the caller's family. */
  get(id: string): Promise<CalendarEvent>;
  create(input: CalendarEventInput): Promise<CalendarEvent[]>;
  update(id: string, edit: CalendarEventEdit): Promise<CalendarEvent[]>;
  remove(id: string, scope: EditScope): Promise<string[]>;
  /** The caller's live feed link (never its secret), or null when they have none. */
  feedLink(): Promise<CalendarFeed | null>;
  /** Makes the feed link, replacing any live one; the answer holds the only copy of its secret. */
  createFeedLink(): Promise<CreatedCalendarFeedLink>;
  /** Turns the feed link off. */
  deleteFeedLink(): Promise<void>;
};

export const restCalendarApi: CalendarApi = {
  async get(id) {
    return (await apiFetcher<CalendarEventResponse>(calendarEventApiUrl(id))).event;
  },
  async create(input) {
    return (await apiRequest<CalendarEventsResponse>(CALENDAR_EVENTS_API_KEY, { method: "POST", body: JSON.stringify(input) })).events;
  },
  async update(id, edit) {
    return (await apiRequest<CalendarEventsResponse>(calendarEventApiUrl(id), { method: "PATCH", body: JSON.stringify(edit) })).events;
  },
  async remove(id, scope) {
    return (await apiRequest<CalendarDeletedResponse>(calendarEventApiUrl(id, scope), { method: "DELETE" })).deletedIds;
  },
  async feedLink() {
    return (await apiFetcher<CalendarFeedLinkResponse>(CALENDAR_FEED_LINK_API_KEY)).feed;
  },
  createFeedLink() {
    return apiRequest<CreatedCalendarFeedLink>(CALENDAR_FEED_LINK_API_KEY, { method: "POST" });
  },
  async deleteFeedLink() {
    await apiRequest<void>(CALENDAR_FEED_LINK_API_KEY, { method: "DELETE" });
  },
};

const CalendarApiContext = createContext<CalendarApi>(restCalendarApi);

export function CalendarApiProvider({ api, children }: { api: CalendarApi; children: ReactNode }) {
  return <CalendarApiContext.Provider value={api}>{children}</CalendarApiContext.Provider>;
}

export function useCalendarApi() {
  return useContext(CalendarApiContext);
}
