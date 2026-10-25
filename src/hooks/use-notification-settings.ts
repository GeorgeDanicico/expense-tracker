"use client";

import useSWR from "swr";

import { apiRequest } from "@/lib/api/client";
import {
  NOTIFICATION_SETTINGS_API_KEY,
  PUSH_KEY_API_URL,
  PUSH_SUBSCRIPTIONS_API_URL,
  TEST_NOTIFICATION_API_URL,
  type NotificationSettingsResponse,
  type PushKeyResponse,
  type TestNotificationResponse,
} from "@/lib/api/keys";
import { currentSubscription } from "@/lib/notifications/browser";
import type { NotificationSettingsPatch } from "@/lib/notifications/settings-repository";

/** The caller's notification switches and device count, through the SWR cache. */
export function useNotificationSettings() {
  const response = useSWR<NotificationSettingsResponse>(NOTIFICATION_SETTINGS_API_KEY);
  return {
    get settings() {
      return response.data;
    },
    get error() {
      return response.error;
    },
    mutate: response.mutate,
  };
}

/**
 * The server's VAPID public key, loaded before "Enable on this device" is pressed so the click
 * handler can ask for permission straight away. `error` is set (503) while the server has no key.
 */
export function usePushKey(enabled: boolean) {
  const response = useSWR<PushKeyResponse>(enabled ? PUSH_KEY_API_URL : null, { revalidateOnFocus: false });
  return { publicKey: response.data?.publicKey, error: response.error };
}

export function updateNotificationSettings(patch: NotificationSettingsPatch) {
  return apiRequest<NotificationSettingsResponse>(NOTIFICATION_SETTINGS_API_KEY, { method: "PATCH", body: JSON.stringify(patch) });
}

export function registerPushSubscription(subscription: PushSubscriptionJSON) {
  return apiRequest<NotificationSettingsResponse>(PUSH_SUBSCRIPTIONS_API_URL, { method: "POST", body: JSON.stringify(subscription) });
}

export function deletePushSubscription(endpoint: string) {
  return apiRequest<NotificationSettingsResponse>(PUSH_SUBSCRIPTIONS_API_URL, { method: "DELETE", body: JSON.stringify({ endpoint }) });
}

export function sendTestNotification() {
  return apiRequest<TestNotificationResponse>(TEST_NOTIFICATION_API_URL, { method: "POST" });
}

/** How long sign-out waits for this device to unsubscribe before signing out anyway. */
export const SIGN_OUT_UNSUBSCRIBE_TIMEOUT_MS = 3_000;

type SignOutSteps = {
  current: () => Promise<Pick<PushSubscription, "endpoint" | "unsubscribe"> | null>;
  deleteOnServer: (endpoint: string) => Promise<unknown>;
};

/**
 * Before signing out: deletes this browser's subscription on the server (while the session still
 * works) and unsubscribes it in the browser, so the next person to use it gets nobody's
 * notifications. Each step runs even if the other fails. Never throws, and gives up after
 * {@link SIGN_OUT_UNSUBSCRIBE_TIMEOUT_MS}: a failure here must not stop the sign-out.
 */
export async function forgetThisDeviceBeforeSignOut(
  steps: SignOutSteps = { current: currentSubscription, deleteOnServer: deletePushSubscription },
  timeoutMs = SIGN_OUT_UNSUBSCRIBE_TIMEOUT_MS,
) {
  const work = (async () => {
    const subscription = await steps.current();
    if (!subscription) return;
    await Promise.allSettled([steps.deleteOnServer(subscription.endpoint), subscription.unsubscribe()]);
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([work, timeout]);
  clearTimeout(timer);
}
