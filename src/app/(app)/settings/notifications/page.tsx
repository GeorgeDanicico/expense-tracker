"use client";

import { Stack } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { BrowserNotificationsCard, NotificationKindsCard, ThisDeviceCard } from "@/components/settings/notification-cards";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  deletePushSubscription,
  registerPushSubscription,
  sendTestNotification,
  updateNotificationSettings,
  useNotificationSettings,
  usePushKey,
} from "@/hooks/use-notification-settings";
import {
  PushPermissionError,
  browserFacts,
  currentSubscription,
  deviceSupport,
  subscribeThisDevice,
  unsubscribeThisDevice,
  type DeviceSupport,
} from "@/lib/notifications/browser";
import type { NotificationSettingsPatch } from "@/lib/notifications/settings-repository";

export default function NotificationsSettingsPage() {
  useDocumentTitle("Notifications");
  const { settings, error, mutate } = useNotificationSettings();
  const switchForm = useApiForm();
  const kindsForm = useApiForm();
  const deviceForm = useApiForm();
  const [support, setSupport] = useState<DeviceSupport | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const { publicKey, error: keyError } = usePushKey(support === "ready");

  // Looks at this browser once mounted. A browser that is already subscribed is registered again,
  // so the server knows it even if the subscription was removed there (or belonged to another account).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = deviceSupport(browserFacts());
      const subscription = found === "ready" ? await currentSubscription().catch(() => null) : null;
      if (cancelled) return;
      setSupport(found);
      setSubscribed(subscription !== null);
      if (subscription) {
        const updated = await registerPushSubscription(subscription.toJSON()).catch(() => null);
        if (updated && !cancelled) await mutate(updated, { revalidate: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mutate]);

  function save(form: typeof switchForm, patch: NotificationSettingsPatch) {
    void form.submit(async () => {
      const updated = await updateNotificationSettings(patch);
      await mutate(updated, { revalidate: false });
    }, { fallback: "Unable to save your notification settings. Please try again." });
  }

  // Runs straight from the click, with the key already loaded: Safari only asks for permission
  // during a user gesture.
  function enable() {
    setTestMessage("");
    void deviceForm.submit(async () => {
      if (!publicKey) throw new Error("Still getting ready. Try again in a moment.");
      let subscription: PushSubscriptionJSON;
      try {
        subscription = await subscribeThisDevice(publicKey);
      } catch (caught) {
        if (caught instanceof PushPermissionError) {
          const now = deviceSupport(browserFacts());
          setSupport(now);
          // "Blocked" explains itself; a dismissed prompt gets the message.
          if (now === "denied") return;
        }
        throw caught;
      }
      const updated = await registerPushSubscription(subscription);
      setSubscribed(true);
      await mutate(updated, { revalidate: false });
    }, { fallback: "Unable to enable notifications on this device. Please try again.", action: "enable" });
  }

  function disable() {
    setTestMessage("");
    void deviceForm.submit(async () => {
      const endpoint = await unsubscribeThisDevice();
      setSubscribed(false);
      if (endpoint) await mutate(await deletePushSubscription(endpoint), { revalidate: false });
    }, { fallback: "Unable to turn off notifications on this device. Please try again.", action: "disable" });
  }

  function test() {
    setTestMessage("");
    void deviceForm.submit(async () => {
      const result = await sendTestNotification();
      setTestMessage(result.queued ? "Test sent. It arrives within half a minute on every device you enabled." : result.message);
    }, { fallback: "Unable to send a test notification. Please try again.", action: "test" });
  }

  if (error && !settings) return <DataError retry={() => void mutate()} />;
  if (!settings) return <DataLoading label="Loading your notification settings…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <BrowserNotificationsCard
        settings={settings}
        pending={switchForm.pending}
        error={switchForm.error}
        onChange={(pushEnabled) => save(switchForm, { pushEnabled })}
      />
      <ThisDeviceCard
        support={support}
        subscribed={subscribed}
        serverNotReady={keyError !== undefined}
        pendingAction={deviceForm.pendingAction}
        error={deviceForm.error}
        testMessage={testMessage}
        onEnable={enable}
        onDisable={disable}
        onTest={test}
      />
      <NotificationKindsCard
        settings={settings}
        pending={kindsForm.pending}
        error={kindsForm.error}
        onChange={(patch) => save(kindsForm, patch)}
      />
    </Stack>
  );
}
