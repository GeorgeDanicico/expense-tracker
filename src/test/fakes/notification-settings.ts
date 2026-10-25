import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettingsPatch,
  type NotificationSettingsRepository,
  type PushSubscriptionInput,
} from "@/lib/notifications/settings-repository";

/** A push subscription as the fake stores it, with its owner. */
export type FakePushSubscription = PushSubscriptionInput & { userId: string };

/** The test user of `@/test/route`, whom the fake acts as unless `callerId` changes. */
const TEST_USER_ID = "10000000-0000-4000-8000-000000000001";

/**
 * In-memory `NotificationSettingsRepository` acting as `callerId`. `settings` holds each user's
 * switches (missing: the defaults) and `subscriptions` every user's devices; like
 * `register_push_subscription()`, registering an endpoint moves it to the caller. `sendTest` queues
 * onto `tests` (the caller's id) and answers false within `testCooldownMs` of the caller's last one,
 * measured with `now()`.
 */
export class FakeNotificationSettingsRepository implements NotificationSettingsRepository {
  callerId = TEST_USER_ID;
  settings = new Map<string, Required<NotificationSettingsPatch>>();
  subscriptions: FakePushSubscription[] = [];
  tests: { userId: string; at: number }[] = [];
  testCooldownMs = 60_000;
  now: () => number = () => Date.now();

  async get() {
    return {
      ...(this.settings.get(this.callerId) ?? DEFAULT_NOTIFICATION_SETTINGS),
      deviceCount: this.subscriptions.filter((subscription) => subscription.userId === this.callerId).length,
    };
  }

  async update(userId: string, patch: NotificationSettingsPatch) {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    this.settings.set(userId, { ...(this.settings.get(userId) ?? DEFAULT_NOTIFICATION_SETTINGS), ...defined });
    return this.get();
  }

  async registerPushSubscription(subscription: PushSubscriptionInput) {
    this.subscriptions = this.subscriptions.filter((other) => other.endpoint !== subscription.endpoint);
    this.subscriptions.push({ ...subscription, userId: this.callerId });
  }

  async deletePushSubscription(endpoint: string) {
    const before = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter(
      (subscription) => subscription.endpoint !== endpoint || subscription.userId !== this.callerId,
    );
    return this.subscriptions.length < before;
  }

  async sendTest() {
    const now = this.now();
    if (this.tests.some((test) => test.userId === this.callerId && now - test.at < this.testCooldownMs)) return false;
    this.tests.push({ userId: this.callerId, at: now });
    return true;
  }
}
