import "server-only";

import type { WorkerStore } from "@/lib/notifications/worker-store";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin-client";

/**
 * `WorkerStore` on `worker_heartbeats`, `notifications` and `reminders` with the admin client: the
 * worker acts for every user, and the outbox and heartbeats have no policies for signed-in users.
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
  };
}
