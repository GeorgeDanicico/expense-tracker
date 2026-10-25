"use client";

import { Box, Button, Flex, List, Stack, Switch, Text } from "@chakra-ui/react";
import { BellOff, BellRing, Send } from "lucide-react";

import { Card } from "@/components/ui/card";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { BRAND } from "@/lib/brand";
import type { DeviceSupport } from "@/lib/notifications/browser";
import type { NotificationSettings } from "@/lib/notifications/settings-repository";

export const BROWSER_NOTIFICATIONS_LABEL = "Browser notifications";
export const ENABLE_LABEL = "Enable on this device";
export const DISABLE_LABEL = "Turn off on this device";
export const SEND_TEST_LABEL = "Send a test";
export const TEST_HINT = "The test notification arrives within half a minute.";
export const NO_NOTIFY_TITLE = "Reminders won't notify you";

/**
 * Why reminders won't reach this user, or null when they will: the Browser notifications switch is
 * off, the Reminders switch is off, or no browser is set up.
 */
export function notificationWarning(settings: Pick<NotificationSettings, "pushEnabled" | "remindersEnabled" | "deviceCount">) {
  if (!settings.pushEnabled) return "Browser notifications are off. Turn them on above to get reminders.";
  if (!settings.remindersEnabled) return "Reminder notifications are off. Turn on Reminders below.";
  if (settings.deviceCount === 0) return "No device is set up yet. Enable notifications on this device below, and on any other you use.";
  return null;
}

/** A labelled switch filling its row, like the AI assistants switch. */
function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Switch.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(details) => onChange(details.checked)}
      colorPalette="brand"
      display="flex"
      justifyContent="space-between"
      alignItems="flex-start"
      gap="4"
      width="full"
    >
      <Stack gap="0.5" minW="0">
        <Switch.Label textStyle="bodySm" fontWeight="medium">
          {label}
        </Switch.Label>
        {description ? (
          <Text textStyle="caption" color="fg.muted">
            {description}
          </Text>
        ) : null}
      </Stack>
      <Switch.HiddenInput />
      <Switch.Control flexShrink="0" mt="0.5">
        <Switch.Thumb />
      </Switch.Control>
    </Switch.Root>
  );
}

/** The Browser notifications switch, with the warning when reminders won't notify. */
export function BrowserNotificationsCard({
  settings,
  pending = false,
  error,
  onChange,
}: {
  settings: NotificationSettings;
  pending?: boolean;
  error?: string;
  onChange: (pushEnabled: boolean) => void;
}) {
  const warning = notificationWarning(settings);
  return (
    <Card>
      <Card.Header
        title="Notifications"
        description={`${BRAND.name} sends reminders and to-do updates as notifications on the browsers and phones you enable.`}
      />
      <Card.Body>
        <Stack gap="3">
          <SwitchRow
            label={BROWSER_NOTIFICATIONS_LABEL}
            description="Off: nothing is sent to any of your devices."
            checked={settings.pushEnabled}
            disabled={pending}
            onChange={onChange}
          />
          {warning ? (
            <InlineAlert status="warning" title={NO_NOTIFY_TITLE}>
              {warning}
            </InlineAlert>
          ) : null}
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}

/** The steps to add the app to the home screen on an iPhone or iPad. */
function HomeScreenSteps() {
  return (
    <InlineAlert status="info" title="Add the app to your home screen first">
      <Stack gap="1.5">
        <Text>On iPhone and iPad, notifications only work in the app on your home screen (iOS 16.4 or later).</Text>
        <List.Root as="ol" ps="4" gap="0.5">
          <List.Item>In Safari, tap the Share button.</List.Item>
          <List.Item>Tap Add to Home Screen, then Add.</List.Item>
          <List.Item>Open {BRAND.name} from your home screen and come back to Settings → Notifications.</List.Item>
        </List.Root>
      </Stack>
    </InlineAlert>
  );
}

/** How to unblock notifications after "Block" was chosen. */
function BlockedHelp() {
  return (
    <InlineAlert status="warning" title="Notifications are blocked for this site">
      <Stack gap="1.5">
        <Text>
          Allow them in your browser&apos;s settings: click the icon at the left of the address bar, set Notifications to
          Allow, then reload this page.
        </Text>
        <Text>
          In the {BRAND.name} app on an iPhone: Settings → Notifications → {BRAND.name} → Allow Notifications.
        </Text>
      </Stack>
    </InlineAlert>
  );
}

export type ThisDeviceProps = {
  /** Null until the page has looked at the browser (on the server and the first render). */
  support: DeviceSupport | null;
  subscribed: boolean;
  /** The server has no VAPID key, so nothing can be enabled. */
  serverNotReady?: boolean;
  pendingAction: string | null;
  error?: string;
  /** The answer to the last test, such as "arrives within half a minute". */
  testMessage?: string;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
};

/** "This device": enable or turn off push on this browser, and send a test. */
export function ThisDeviceCard({ support, subscribed, serverNotReady = false, pendingAction, error, testMessage, onEnable, onDisable, onTest }: ThisDeviceProps) {
  const busy = pendingAction !== null;
  const on = support === "ready" && subscribed;

  let body;
  if (support === null) {
    body = <Text textStyle="bodySm" color="fg.muted">Checking this browser…</Text>;
  } else if (support === "unsupported") {
    body = (
      <InlineAlert status="neutral" title="This browser can't show notifications">
        Use Chrome, Edge or Firefox, or Safari on macOS 13 or later.
      </InlineAlert>
    );
  } else if (support === "ios-home-screen") {
    body = <HomeScreenSteps />;
  } else if (support === "denied") {
    body = <BlockedHelp />;
  } else {
    body = (
      <Stack gap="3">
        <Text textStyle="bodySm" color="fg.muted">
          {on
            ? "This device gets your notifications."
            : "Press the button once on each browser or phone where you want notifications. Your browser asks for permission."}
        </Text>
        {serverNotReady && !on ? (
          <InlineAlert status="neutral">Notifications aren&apos;t set up on this server yet.</InlineAlert>
        ) : null}
        <Flex gap="2" wrap="wrap">
          {on ? (
            <Button variant="outline" onClick={onDisable} loading={pendingAction === "disable"} disabled={busy}>
              <BellOff size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> {DISABLE_LABEL}
            </Button>
          ) : (
            <Button variant="solid" colorPalette="brand" onClick={onEnable} loading={pendingAction === "enable"} disabled={busy || serverNotReady}>
              <BellRing size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> {ENABLE_LABEL}
            </Button>
          )}
        </Flex>
      </Stack>
    );
  }

  return (
    <Card>
      <Card.Header title="This device" description="Each browser and phone is set up on its own." />
      <Card.Body>
        <Stack gap="4">
          {body}
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
          <Box borderTopWidth="1px" borderColor="border" pt="4">
            <Stack gap="2" align="flex-start">
              <Text textStyle="bodySm" fontWeight="medium">
                Send a test
              </Text>
              <Text textStyle="caption" color="fg.muted">
                {TEST_HINT} It goes to every device you enabled.
              </Text>
              <Button size="sm" variant="outline" onClick={onTest} loading={pendingAction === "test"} disabled={busy}>
                <Send size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> {SEND_TEST_LABEL}
              </Button>
              {testMessage ? <InlineAlert status="success">{testMessage}</InlineAlert> : null}
            </Stack>
          </Box>
        </Stack>
      </Card.Body>
    </Card>
  );
}

/** The Reminders and To-dos switches. */
export function NotificationKindsCard({
  settings,
  pending = false,
  error,
  onChange,
}: {
  settings: Pick<NotificationSettings, "remindersEnabled" | "todosEnabled">;
  pending?: boolean;
  error?: string;
  onChange: (patch: { remindersEnabled?: boolean; todosEnabled?: boolean }) => void;
}) {
  return (
    <Card>
      <Card.Header title="What to notify me about" />
      <Card.Body>
        <Stack gap="4">
          <SwitchRow
            label="Reminders"
            description="At each reminder's notify times."
            checked={settings.remindersEnabled}
            disabled={pending}
            onChange={(remindersEnabled) => onChange({ remindersEnabled })}
          />
          <SwitchRow
            label="To-dos"
            description="When someone assigns you a card, and on the morning a card of yours is due."
            checked={settings.todosEnabled}
            disabled={pending}
            onChange={(todosEnabled) => onChange({ todosEnabled })}
          />
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}
