import { describe, expect, it } from "vitest";

import { FakeNotificationSettingsRepository } from "./notification-settings";

describe("FakeNotificationSettingsRepository", () => {
  it("starts on the defaults and keeps each user's switches apart", async () => {
    const settings = new FakeNotificationSettingsRepository();

    expect(await settings.get()).toEqual({ pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: true, deviceCount: 0 });
    expect(await settings.update(settings.callerId, { todosEnabled: false })).toMatchObject({ todosEnabled: false, pushEnabled: true });

    settings.callerId = "someone-else";
    expect(await settings.get()).toMatchObject({ todosEnabled: true });
  });

  it("moves a registered endpoint to the caller and deletes only the caller's", async () => {
    const settings = new FakeNotificationSettingsRepository();
    const subscription = { endpoint: "https://push.example.test/1", p256dh: "k", auth: "a", userAgent: "" };
    await settings.registerPushSubscription(subscription);
    const first = settings.callerId;

    settings.callerId = "someone-else";
    await settings.registerPushSubscription(subscription);
    expect(settings.subscriptions).toEqual([{ ...subscription, userId: "someone-else" }]);

    settings.callerId = first;
    expect(await settings.deletePushSubscription(subscription.endpoint)).toBe(false);
    expect(await settings.get()).toMatchObject({ deviceCount: 0 });
  });

  it("queues at most one test a minute", async () => {
    const settings = new FakeNotificationSettingsRepository();
    let now = 0;
    settings.now = () => now;

    expect(await settings.sendTest()).toBe(true);
    now = 59_000;
    expect(await settings.sendTest()).toBe(false);
    now = 60_000;
    expect(await settings.sendTest()).toBe(true);
  });
});
