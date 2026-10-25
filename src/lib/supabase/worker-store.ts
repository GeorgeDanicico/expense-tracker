import "server-only";

import type { NotificationOutcome, RecipientSettings, WorkerStore } from "@/lib/notifications/worker-store";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin-client";

/**
 * `WorkerStore` on `worker_heartbeats`, `notifications`, `reminders`, `notification_settings` and
 * `push_subscriptions` with the admin client: the worker acts for every user, and the outbox and
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
        .select("user_id, push_enabled, reminders_enabled, todos_enabled")
        .in("user_id", [...userIds]);
      if (error) throw new Error(`Unable to load notification settings: ${error.message}`);
      for (const row of data) {
        settings.set(row.user_id, {
          pushEnabled: row.push_enabled,
          remindersEnabled: row.reminders_enabled,
          todosEnabled: row.todos_enabled,
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

/** The columns an outcome writes. The lease is always released. */
function outcomeValues(outcome: NotificationOutcome) {
  const common = { status: outcome.status, attempts: outcome.attempts, last_error: outcome.lastError, locked_until: null };
  if (outcome.status === "pending") return { ...common, send_at: outcome.sendAt.toISOString() };
  if (outcome.status === "sent") return { ...common, sent_at: outcome.sentAt.toISOString() };
  return common;
}
