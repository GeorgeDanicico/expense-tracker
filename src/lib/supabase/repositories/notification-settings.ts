import "server-only";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettingsPatch,
  type NotificationSettingsRepository,
} from "@/lib/notifications/settings-repository";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const LOAD_ERROR = "Unable to load your notification settings.";
const SAVE_ERROR = "Unable to save your notification settings.";
const REGISTER_ERROR = "Unable to enable notifications on this device.";
const UNREGISTER_ERROR = "Unable to turn off notifications on this device.";
const TEST_ERROR = "Unable to send a test notification.";

/** The patch's switches as columns; absent switches stay as they are. */
function patchValues(patch: NotificationSettingsPatch) {
  return {
    ...(patch.pushEnabled !== undefined ? { push_enabled: patch.pushEnabled } : {}),
    ...(patch.remindersEnabled !== undefined ? { reminders_enabled: patch.remindersEnabled } : {}),
    ...(patch.todosEnabled !== undefined ? { todos_enabled: patch.todosEnabled } : {}),
    ...(patch.calendarEnabled !== undefined ? { calendar_enabled: patch.calendarEnabled } : {}),
  };
}

/**
 * `NotificationSettingsRepository` on `notification_settings` and `push_subscriptions`, acting as
 * the request's caller: RLS limits both to the caller's own rows. Registering goes through
 * `register_push_subscription()` (it may move another user's row with the same endpoint) and the
 * test through `send_test_notification()`, as users can't write the outbox.
 */
export const supabaseNotificationSettingsRepository: NotificationSettingsRepository = {
  async get() {
    const supabase = await createClient();
    const [settings, devices] = await Promise.all([
      supabase.from("notification_settings").select("push_enabled, reminders_enabled, todos_enabled, calendar_enabled").maybeSingle(),
      supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),
    ]);
    if (settings.error || devices.error) throw new Error(LOAD_ERROR);
    return {
      ...(settings.data
        ? {
            pushEnabled: settings.data.push_enabled,
            remindersEnabled: settings.data.reminders_enabled,
            todosEnabled: settings.data.todos_enabled,
            calendarEnabled: settings.data.calendar_enabled,
          }
        : DEFAULT_NOTIFICATION_SETTINGS),
      deviceCount: devices.count ?? 0,
    };
  },

  /** An upsert on the caller's row: a missing row is created with the defaults plus the patch. */
  async update(userId, patch) {
    const values = patchValues(patch);
    if (Object.keys(values).length > 0) {
      const supabase = await createClient();
      const { error } = await supabase.from("notification_settings")
        .upsert({ user_id: userId, ...values }, { onConflict: "user_id" });
      if (error) throw translateDatabaseError(error, SAVE_ERROR);
    }
    return supabaseNotificationSettingsRepository.get();
  },

  async registerPushSubscription({ endpoint, p256dh, auth, userAgent }) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("register_push_subscription", {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: userAgent,
    });
    if (error) throw translateDatabaseError(error, REGISTER_ERROR);
  },

  async deletePushSubscription(endpoint) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).select("id");
    if (error) throw translateDatabaseError(error, UNREGISTER_ERROR);
    return data.length > 0;
  },

  async sendTest() {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_test_notification");
    if (error) throw translateDatabaseError(error, TEST_ERROR);
    return data === true;
  },
};
