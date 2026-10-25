"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import {
  reminderApiUrl,
  reminderCompleteApiUrl,
  REMINDERS_API_KEY,
  reminderSnoozeApiUrl,
  type ReminderResponse,
} from "@/lib/api/keys";
import type { ListedReminder } from "@/lib/reminders/list";
import type { ReminderInput, SnoozeInput } from "@/lib/validation/reminder";

/**
 * Every field of a reminder, as POST and PATCH take it. PATCH replaces the whole reminder, so the
 * form always sends all of them, never only the changed ones.
 */
export type ReminderFields = ReminderInput;

/** The reminders page's writes. The page uses the REST API; `/dev/preview` swaps in an in-memory one. */
export type ReminderApi = {
  create(fields: ReminderFields): Promise<ListedReminder>;
  update(id: string, fields: ReminderFields): Promise<ListedReminder>;
  remove(id: string): Promise<void>;
  complete(id: string): Promise<ListedReminder>;
  snooze(id: string, snooze: SnoozeInput): Promise<ListedReminder>;
};

export const restReminderApi: ReminderApi = {
  async create(fields) {
    return (await apiRequest<ReminderResponse>(REMINDERS_API_KEY, { method: "POST", body: JSON.stringify(fields) })).reminder;
  },
  async update(id, fields) {
    return (await apiRequest<ReminderResponse>(reminderApiUrl(id), { method: "PATCH", body: JSON.stringify(fields) })).reminder;
  },
  async remove(id) {
    await apiRequest<{ success: true }>(reminderApiUrl(id), { method: "DELETE" });
  },
  async complete(id) {
    return (await apiRequest<ReminderResponse>(reminderCompleteApiUrl(id), { method: "POST" })).reminder;
  },
  async snooze(id, snooze) {
    return (await apiRequest<ReminderResponse>(reminderSnoozeApiUrl(id), { method: "POST", body: JSON.stringify(snooze) })).reminder;
  },
};

const ReminderApiContext = createContext<ReminderApi>(restReminderApi);

export function ReminderApiProvider({ api, children }: { api: ReminderApi; children: ReactNode }) {
  return <ReminderApiContext.Provider value={api}>{children}</ReminderApiContext.Provider>;
}

export function useReminderApi() {
  return useContext(ReminderApiContext);
}
