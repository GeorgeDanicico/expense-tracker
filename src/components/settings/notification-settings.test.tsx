import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import NotificationsSettingsPage from "@/app/(app)/settings/notifications/page";
import { ledgerSystem } from "@/components/ui/theme";
import { forgetThisDeviceBeforeSignOut } from "@/hooks/use-notification-settings";
import { NOTIFICATION_SETTINGS_API_KEY } from "@/lib/api/keys";
import { applicationServerKey, deviceSupport, isAppleMobile, type BrowserFacts } from "@/lib/notifications/browser";
import type { NotificationSettings } from "@/lib/notifications/settings-repository";

import {
  BROWSER_NOTIFICATIONS_LABEL,
  BrowserNotificationsCard,
  DISABLE_LABEL,
  ENABLE_LABEL,
  NO_NOTIFY_TITLE,
  NotificationKindsCard,
  SEND_TEST_LABEL,
  TEST_HINT,
  ThisDeviceCard,
  notificationWarning,
  type ThisDeviceProps,
} from "./notification-cards";

// Component tests render static markup (no DOM), so behaviour is tested through the pure functions
// the components call, plus static renders of each state.

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/settings/notifications" }));

const ON: NotificationSettings = { pushEnabled: true, remindersEnabled: true, todosEnabled: true, deviceCount: 1 };

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

/** `text` as React's static markup escapes it. */
function escaped(text: string) {
  return text.replaceAll("'", "&#x27;");
}

/** Whether every switch's checkbox in `html` is checked, in order. */
function switchesChecked(html: string) {
  return [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map(([input]) => / checked=""/.test(input));
}

const noop = () => undefined;
const device = (props: Partial<ThisDeviceProps>) =>
  render(<ThisDeviceCard support="ready" subscribed={false} pendingAction={null} onEnable={noop} onDisable={noop} onTest={noop} {...props} />);

describe("notificationWarning", () => {
  it("is null when reminders will notify", () => {
    expect(notificationWarning(ON)).toBeNull();
  });

  it.each([
    [{ pushEnabled: false }, "Browser notifications are off"],
    [{ remindersEnabled: false }, "Reminder notifications are off"],
    [{ deviceCount: 0 }, "No device is set up yet"],
  ])("explains %j", (change, reason) => {
    expect(notificationWarning({ ...ON, ...change })).toContain(reason);
  });
});

describe("BrowserNotificationsCard", () => {
  it("shows the switch and no warning when everything is set up", () => {
    const html = render(<BrowserNotificationsCard settings={ON} onChange={noop} />);
    expect(html).toContain(BROWSER_NOTIFICATIONS_LABEL);
    expect(switchesChecked(html)).toEqual([true]);
    expect(html).not.toContain(escaped(NO_NOTIFY_TITLE));
  });

  it("warns that reminders won't notify when the switch is off or there are no devices", () => {
    for (const settings of [{ ...ON, pushEnabled: false }, { ...ON, deviceCount: 0 }]) {
      expect(render(<BrowserNotificationsCard settings={settings} onChange={noop} />)).toContain(escaped(NO_NOTIFY_TITLE));
    }
  });
});

describe("ThisDeviceCard", () => {
  it("offers Enable on this device, and Send a test with its timing", () => {
    const html = device({});
    expect(html).toContain(ENABLE_LABEL);
    expect(html).not.toContain(DISABLE_LABEL);
    expect(html).toContain(SEND_TEST_LABEL);
    expect(html).toContain(TEST_HINT);
    expect(html).toContain("half a minute");
  });

  it("becomes Turn off on this device once subscribed", () => {
    const html = device({ subscribed: true });
    expect(html).toContain(DISABLE_LABEL);
    expect(html).not.toContain(ENABLE_LABEL);
  });

  it("explains an unsupported browser without a button", () => {
    const html = device({ support: "unsupported" });
    expect(html).toContain("This browser can&#x27;t show notifications");
    expect(html).not.toContain(ENABLE_LABEL);
  });

  it("gives the Add to Home Screen steps on an iPhone outside the home-screen app", () => {
    const html = device({ support: "ios-home-screen" });
    expect(html).toContain("Add to Home Screen");
    expect(html).toContain("Share");
    expect(html).not.toContain(ENABLE_LABEL);
  });

  it("explains how to allow notifications again after they were blocked", () => {
    const html = device({ support: "denied" });
    expect(html).toContain("Notifications are blocked for this site");
    expect(html).toContain("reload this page");
    expect(html).not.toContain(ENABLE_LABEL);
  });

  it("disables Enable while the server has no key", () => {
    const html = device({ serverNotReady: true });
    expect(html).toContain("set up on this server yet");
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>.*?${ENABLE_LABEL}`));
  });

  it("shows the test's answer", () => {
    expect(device({ testMessage: "A test was sent less than a minute ago." })).toContain("A test was sent less than a minute ago.");
  });
});

describe("NotificationKindsCard", () => {
  it("shows the Reminders and To-dos switches", () => {
    const html = render(<NotificationKindsCard settings={{ remindersEnabled: true, todosEnabled: false }} onChange={noop} />);
    expect(html).toContain("Reminders");
    expect(html).toContain("To-dos");
    expect(switchesChecked(html)).toEqual([true, false]);
  });
});

describe("NotificationsSettingsPage", () => {
  it("renders the three cards from the cached settings, checking the browser after mounting", () => {
    const html = render(
      <SWRConfig value={{ provider: () => new Map(), fallback: { [NOTIFICATION_SETTINGS_API_KEY]: { ...ON, deviceCount: 0 } } }}>
        <NotificationsSettingsPage />
      </SWRConfig>,
    );

    expect(html).toContain(BROWSER_NOTIFICATIONS_LABEL);
    expect(html).toContain(escaped(NO_NOTIFY_TITLE));
    expect(html).toContain("This device");
    expect(html).toContain("Checking this browser");
    expect(html).toContain("What to notify me about");
  });
});

describe("deviceSupport", () => {
  const chrome: BrowserFacts = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
    maxTouchPoints: 0,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    permission: "default",
  };
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

  it("is ready in a browser with push", () => {
    expect(deviceSupport(chrome)).toBe("ready");
    expect(deviceSupport({ ...chrome, permission: "granted" })).toBe("ready");
  });

  it("is denied once notifications were blocked", () => {
    expect(deviceSupport({ ...chrome, permission: "denied" })).toBe("denied");
  });

  it("is unsupported without a service worker, the Push API or notifications", () => {
    expect(deviceSupport({ ...chrome, hasServiceWorker: false })).toBe("unsupported");
    expect(deviceSupport({ ...chrome, hasPushManager: false })).toBe("unsupported");
    expect(deviceSupport({ ...chrome, hasNotification: false, permission: null })).toBe("unsupported");
  });

  it("asks an iPhone or iPad in Safari to add the app to the home screen", () => {
    const safari = { ...chrome, hasPushManager: false, hasNotification: false, permission: null };
    expect(deviceSupport({ ...safari, userAgent: iphone, maxTouchPoints: 5 })).toBe("ios-home-screen");
    expect(deviceSupport({ ...safari, userAgent: ipad, maxTouchPoints: 5 })).toBe("ios-home-screen");
  });

  it("is ready in the home-screen app on an iPhone", () => {
    expect(deviceSupport({ ...chrome, userAgent: iphone, maxTouchPoints: 5, standalone: true })).toBe("ready");
  });

  it("doesn't take a Mac without touch for an iPad", () => {
    expect(isAppleMobile({ userAgent: ipad, maxTouchPoints: 0 })).toBe(false);
  });
});

describe("applicationServerKey", () => {
  it("decodes a base64url key without padding", () => {
    expect([...applicationServerKey("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("forgetThisDeviceBeforeSignOut", () => {
  it("deletes the subscription on the server and unsubscribes the browser", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const deleteOnServer = vi.fn().mockResolvedValue({});

    await forgetThisDeviceBeforeSignOut({ current: async () => ({ endpoint: "https://push.example.test/1", unsubscribe }), deleteOnServer });

    expect(deleteOnServer).toHaveBeenCalledWith("https://push.example.test/1");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does nothing without a subscription", async () => {
    const deleteOnServer = vi.fn();
    await forgetThisDeviceBeforeSignOut({ current: async () => null, deleteOnServer });
    expect(deleteOnServer).not.toHaveBeenCalled();
  });

  it("still unsubscribes when the server fails, and never throws", async () => {
    const unsubscribe = vi.fn().mockRejectedValue(new Error("browser"));
    const deleteOnServer = vi.fn().mockRejectedValue(new Error("server"));

    await expect(forgetThisDeviceBeforeSignOut({ current: async () => ({ endpoint: "e", unsubscribe }), deleteOnServer })).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledOnce();
    await expect(forgetThisDeviceBeforeSignOut({ current: () => Promise.reject(new Error("no sw")), deleteOnServer })).resolves.toBeUndefined();
  });

  it("gives up after the timeout so sign-out goes on", async () => {
    vi.useFakeTimers();
    try {
      const done = forgetThisDeviceBeforeSignOut({ current: () => new Promise(() => undefined), deleteOnServer: vi.fn() }, 3_000);
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
