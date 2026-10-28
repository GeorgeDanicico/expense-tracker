/** The caller's notification switches, and how many of their browsers are set up for push. */
export type NotificationSettings = {
  /** The Browser notifications switch. */
  pushEnabled: boolean;
  remindersEnabled: boolean;
  todosEnabled: boolean;
  calendarEnabled: boolean;
  /** The caller's registered push subscriptions (devices). */
  deviceCount: number;
};

/** A change to the switches: any subset of them. */
export type NotificationSettingsPatch = Partial<Pick<NotificationSettings, "pushEnabled" | "remindersEnabled" | "todosEnabled" | "calendarEnabled">>;

/** Everything on: what a user without a `notification_settings` row has. */
export const DEFAULT_NOTIFICATION_SETTINGS = {
  pushEnabled: true,
  remindersEnabled: true,
  todosEnabled: true,
  calendarEnabled: true,
} as const satisfies Required<NotificationSettingsPatch>;

/** A browser's Web Push subscription, as `PushSubscription.toJSON()` gives it, plus its user agent. */
export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
};

/**
 * The caller's notification settings and push devices. Get it from `getRepositories()`; never
 * import an implementation. Every method acts as the signed-in caller (RLS: owner only).
 */
export interface NotificationSettingsRepository {
  /** The caller's switches (`DEFAULT_NOTIFICATION_SETTINGS` when they never changed one) and device count. */
  get(): Promise<NotificationSettings>;
  /** Changes the given switches of `userId` (the authenticated caller) and returns the settings. */
  update(userId: string, patch: NotificationSettingsPatch): Promise<NotificationSettings>;
  /**
   * Registers this browser for the caller. A subscription with the same endpoint is moved to the
   * caller, whoever had it (a browser that switched accounts).
   */
  registerPushSubscription(subscription: PushSubscriptionInput): Promise<void>;
  /** Deletes the caller's subscription with this endpoint, returning false when they have none. */
  deletePushSubscription(endpoint: string): Promise<boolean>;
  /** Queues a test notification for the caller; false (nothing queued) within a minute of the last one. */
  sendTest(): Promise<boolean>;
}
