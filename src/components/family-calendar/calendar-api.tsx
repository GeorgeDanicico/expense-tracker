"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import {
  calendarEventApiUrl,
  CALENDAR_EVENTS_API_KEY,
  type CalendarDeletedResponse,
  type CalendarEventsResponse,
} from "@/lib/api/keys";
import type { CalendarEvent, EditScope } from "@/lib/family-calendar/types";
import type { CalendarEventEdit, CalendarEventInput } from "@/lib/validation/calendar-event";

/**
 * The calendar's writes. The page uses the REST API; `/dev/preview` swaps in an in-memory one.
 * `create` and `update` answer with the rows they added or changed, `remove` with the ids deleted.
 */
export type CalendarApi = {
  create(input: CalendarEventInput): Promise<CalendarEvent[]>;
  update(id: string, edit: CalendarEventEdit): Promise<CalendarEvent[]>;
  remove(id: string, scope: EditScope): Promise<string[]>;
};

export const restCalendarApi: CalendarApi = {
  async create(input) {
    return (await apiRequest<CalendarEventsResponse>(CALENDAR_EVENTS_API_KEY, { method: "POST", body: JSON.stringify(input) })).events;
  },
  async update(id, edit) {
    return (await apiRequest<CalendarEventsResponse>(calendarEventApiUrl(id), { method: "PATCH", body: JSON.stringify(edit) })).events;
  },
  async remove(id, scope) {
    return (await apiRequest<CalendarDeletedResponse>(calendarEventApiUrl(id, scope), { method: "DELETE" })).deletedIds;
  },
};

const CalendarApiContext = createContext<CalendarApi>(restCalendarApi);

export function CalendarApiProvider({ api, children }: { api: CalendarApi; children: ReactNode }) {
  return <CalendarApiContext.Provider value={api}>{children}</CalendarApiContext.Provider>;
}

export function useCalendarApi() {
  return useContext(CalendarApiContext);
}
