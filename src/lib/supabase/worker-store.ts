import "server-only";

import type { Database } from "@/lib/database.types";
import type { ClaimedReminder, NotificationOutcome, RecipientSettings, WorkerStore } from "@/lib/notifications/worker-store";
import { REPEAT_UNITS, type RepeatUnit } from "@/lib/reminders/types";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin-client";

type ReminderRow = Database["public"]["Tables"]["reminders"]["Row"];

/** Postgres' unique_violation: here, a `dedupe_key` that's already queued. */
const UNIQUE_VIOLATION = "23505";

/**
 * `WorkerStore` on `worker_heartbeats`, `notifications`, `reminders`, `notification_settings`,
 * `push_subscriptions`, `todos`, `calendar_events` and `family_members` with the admin client: the worker acts for every user, and the outbox and
 * heartbeats have no policies for signed-in users.
 * Errors carry the database's message (never the key) so the worker's log says what went wrong.
 *
 * SECURITY: only the worker (`src/worker/main.ts`) creates this store.
 */
export function createSupabaseWorkerStore(client: AdminClient = createAdminClient()): WorkerStore {
  return {
    async writeHeartbeat({ name, beatAt, version }) {
      const { error } = await client
        .from("worker_heartbeats")
        .upsert({ name, beat_at: beatAt.toISOString(), version }, { onConflict: "name" });
      if (error) throw new Error(`Unable to write the heartbeat: ${error.message}`);
    },

    /** Two head-only counts with the claim functions' due conditions; nothing is leased. */
    async countDue(now) {
      const at = now.toISOString();
      const [notifications, reminders] = await Promise.all([
        client
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .lte("send_at", at),
        client
          .from("reminders")
          .select("id", { count: "exact", head: true })
          .eq("notifications_muted", false)
          .lte("next_notify_at", at),
      ]);
      if (notifications.error) throw new Error(`Unable to count due notifications: ${notifications.error.message}`);
      if (reminders.error) throw new Error(`Unable to count due reminders: ${reminders.error.message}`);
      return { notifications: notifications.count ?? 0, reminders: reminders.count ?? 0 };
    },

    async claimNotifications(batch) {
      const { data, error } = await client.rpc("claim_notifications", { p_batch: batch });
      if (error) throw new Error(`Unable to claim notifications: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        payload: row.payload,
        attempts: row.attempts,
      }));
    },

    async getRecipientSettings(userIds) {
      const settings = new Map<string, RecipientSettings>();
      if (userIds.length === 0) return settings;
      const { data, error } = await client
        .from("notification_settings")
        .select("user_id, push_enabled, reminders_enabled, todos_enabled, calendar_enabled")
        .in("user_id", [...userIds]);
      if (error) throw new Error(`Unable to load notification settings: ${error.message}`);
      for (const row of data) {
        settings.set(row.user_id, {
          pushEnabled: row.push_enabled,
          remindersEnabled: row.reminders_enabled,
          todosEnabled: row.todos_enabled,
          calendarEnabled: row.calendar_enabled,
        });
      }
      return settings;
    },

    async listDevices(userIds) {
      if (userIds.length === 0) return [];
      const { data, error } = await client
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .in("user_id", [...userIds]);
      if (error) throw new Error(`Unable to load push subscriptions: ${error.message}`);
      return data.map((row) => ({ id: row.id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }));
    },

    async deleteDevice(id) {
      const { error } = await client.from("push_subscriptions").delete().eq("id", id);
      if (error) throw new Error(`Unable to delete a push subscription: ${error.message}`);
    },

    async markDevicesDelivered(ids, at) {
      if (ids.length === 0) return;
      const { error } = await client
        .from("push_subscriptions")
        .update({ last_success_at: at.toISOString() })
        .in("id", [...ids]);
      if (error) throw new Error(`Unable to record a delivery: ${error.message}`);
    },

    async finishNotification(id, outcome) {
      const { error } = await client.from("notifications").update(outcomeValues(outcome)).eq("id", id);
      if (error) throw new Error(`Unable to update a notification: ${error.message}`);
    },

    async claimDueReminders(batch) {
      const { data, error } = await client.rpc("claim_due_reminders", { p_batch: batch });
      if (error) throw new Error(`Unable to claim due reminders: ${error.message}`);
      return (data ?? []).flatMap((row) => {
        const reminder = toClaimedReminder(row);
        return reminder ? [reminder] : [];
      });
    },

    async enqueueNotification({ userId, kind, payload, dedupeKey }) {
      const { error } = await client
        .from("notifications")
        .insert({ user_id: userId, kind, payload, dedupe_key: dedupeKey });
      if (!error) return "queued";
      if (error.code === UNIQUE_VIOLATION) return "duplicate";
      throw new Error(`Unable to queue a notification: ${error.message}`);
    },

    /**
     * One conditional update: it matches only while `updated_at` is the claim's (every write to a
     * reminder sets it, the claim included), the reminder isn't muted and has an open occurrence.
     * When nothing matched, the claim's own lease is released if it's still there.
     */
    async advanceReminder(reminder, nextNotifyAt) {
      const { data, error } = await client
        .from("reminders")
        .update({ next_notify_at: nextNotifyAt?.toISOString() ?? null, notify_locked_until: null })
        .eq("id", reminder.id)
        .eq("updated_at", reminder.updatedAt)
        .eq("notifications_muted", false)
        .not("next_due_on", "is", null)
        .select("id");
      if (error) throw new Error(`Unable to advance a reminder: ${error.message}`);
      if (data.length > 0) return "advanced";

      const released = await client
        .from("reminders")
        .update({ notify_locked_until: null })
        .eq("id", reminder.id)
        .eq("notify_locked_until", reminder.lockedUntil);
      if (released.error) throw new Error(`Unable to release a reminder: ${released.error.message}`);
      return "changed";
    },

    /**
     * Two reads, as `todos` has no declared relationship to embed: the open assigned cards due
     * that day, then their assignees' users. A card whose member row is gone is left out.
     */
    async listOpenTodosDueOn(date) {
      const { data: todos, error } = await client
        .from("todos")
        .select("id, title, assignee_member_id")
        .eq("due_date", date)
        .neq("status", "done")
        .not("assignee_member_id", "is", null)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`Unable to load the to-dos due today: ${error.message}`);
      if (todos.length === 0) return [];

      const memberIds = [...new Set(todos.map((todo) => todo.assignee_member_id!))];
      const { data: members, error: membersError } = await client
        .from("family_members")
        .select("id, user_id")
        .in("id", memberIds);
      if (membersError) throw new Error(`Unable to load the to-dos' assignees: ${membersError.message}`);
      const userOf = new Map(members.map((member) => [member.id, member.user_id]));

      return todos.flatMap((todo) => {
        const assigneeUserId = userOf.get(todo.assignee_member_id!);
        return assigneeUserId ? [{ id: todo.id, title: todo.title, assigneeUserId }] : [];
      });
    },

    async claimDueCalendarEvents(batch) {
      const { data, error } = await client.rpc("claim_due_calendar_events", { p_batch: batch });
      if (error) throw new Error(`Unable to claim due calendar events: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        allDay: row.all_day,
        startsAt: new Date(row.starts_at),
        timezone: row.timezone,
        notifyAt: new Date(row.notify_at),
        notifyAtStored: row.notify_at,
        attendeeUserIds: row.attendee_user_ids,
      }));
    },

    /**
     * One conditional update: it matches only while `notify_at` is the claim's and `notified_at` is
     * still empty (an edit that moves the time sets a new `notify_at` and clears `notified_at`).
     * The lease is released with it. `calendar_events_guard` leaves `updated_at` alone for this.
     */
    async markEventNotified(event, at) {
      const { data, error } = await client
        .from("calendar_events")
        .update({ notified_at: at.toISOString(), notify_locked_until: null })
        .eq("id", event.id)
        .eq("notify_at", event.notifyAtStored)
        .is("notified_at", null)
        .select("id");
      if (error) throw new Error(`Unable to mark an event notified: ${error.message}`);
      return data.length > 0 ? "notified" : "changed";
    },

    async deleteOldNotifications(before) {
      const { count, error } = await client
        .from("notifications")
        .delete({ count: "exact" })
        .in("status", ["sent", "skipped"])
        .lt("created_at", before.toISOString());
      if (error) throw new Error(`Unable to delete old notifications: ${error.message}`);
      return count ?? 0;
    },
  };
}

/**
 * A claimed row as the worker reads it. A row the claim returned without a due time or lease, or
 * with a repeat unit this code doesn't know, is left to its lease (null).
 */
function toClaimedReminder(row: ReminderRow): ClaimedReminder | null {
  if (row.next_notify_at === null || row.notify_locked_until === null) return null;
  if (!(REPEAT_UNITS as readonly string[]).includes(row.repeat_unit)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    startsOn: row.starts_on,
    // A `time` column comes back as `HH:MM:SS`.
    timeOfDay: row.time_of_day.slice(0, 5),
    timezone: row.timezone,
    repeatUnit: row.repeat_unit as RepeatUnit,
    repeatInterval: row.repeat_interval,
    leadMinutes: row.lead_minutes,
    notificationsMuted: row.notifications_muted,
    nextDueOn: row.next_due_on,
    snoozedUntil: row.snoozed_until === null ? null : new Date(row.snoozed_until).toISOString(),
    nextNotifyAt: new Date(row.next_notify_at),
    // Kept exactly as Postgres wrote them: the conditional update compares them.
    updatedAt: row.updated_at,
    lockedUntil: row.notify_locked_until,
  };
}

/** The columns an outcome writes. The lease is always released. */
function outcomeValues(outcome: NotificationOutcome) {
  const common = { status: outcome.status, attempts: outcome.attempts, last_error: outcome.lastError, locked_until: null };
  if (outcome.status === "pending") return { ...common, send_at: outcome.sendAt.toISOString() };
  if (outcome.status === "sent") return { ...common, sent_at: outcome.sentAt.toISOString() };
  return common;
}
