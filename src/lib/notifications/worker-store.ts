/** How many rows are due at a moment: what the next claims would pick up, leases aside. */
export type DueCounts = {
  /** Pending outbox rows whose `send_at` has passed. */
  notifications: number;
  /** Unmuted reminders whose `next_notify_at` has passed. */
  reminders: number;
};

/** One worker's heartbeat: its name, when it last ticked and the build it runs. */
export type Heartbeat = {
  name: string;
  beatAt: Date;
  version: string;
};

/** The kinds of outbox row (`notifications.kind`). */
export const NOTIFICATION_KINDS = ["reminder", "todo_assigned", "todo_due", "test"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** An outbox row the worker has claimed (leased) for sending. */
export type ClaimedNotification = {
  id: string;
  userId: string;
  /** A kind this code doesn't know is marked failed rather than sent. */
  kind: string;
  /** `{ title, body, url, tag }` as stored; checked before sending. */
  payload: unknown;
  /** How many sends were already tried. */
  attempts: number;
};

/** A user's switches, as the worker reads them; a user without a row has every switch on. */
export type RecipientSettings = {
  pushEnabled: boolean;
  remindersEnabled: boolean;
  todosEnabled: boolean;
};

/** One of a user's browsers. */
export type DeviceSubscription = {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * How a claimed row ends this tick. `pending` puts it back with a later `sendAt` (a retry); the
 * other statuses are final. Every outcome releases the lease.
 */
export type NotificationOutcome =
  | { status: "pending"; attempts: number; sendAt: Date; lastError: string }
  | { status: "sent"; attempts: number; sentAt: Date; lastError: string | null }
  | { status: "skipped" | "failed"; attempts: number; lastError: string };

/**
 * The worker's storage. It acts for every user, as the service (secret key), never as a signed-in
 * caller. The Supabase implementation is `src/lib/supabase/worker-store.ts`; tests use a fake.
 */
export interface WorkerStore {
  /** Records that the worker `name` ticked at `beatAt`, replacing its previous heartbeat. */
  writeHeartbeat(heartbeat: Heartbeat): Promise<void>;
  /** Counts the due rows at `now` without claiming (leasing) any of them. */
  countDue(now: Date): Promise<DueCounts>;
  /**
   * Leases up to `batch` due pending outbox rows for 2 minutes (`claim_notifications`) and returns
   * them; another worker skips them until the lease ends or the row is finished.
   */
  claimNotifications(batch: number): Promise<ClaimedNotification[]>;
  /** The switches of each of `userIds` that has a settings row; missing users have the defaults. */
  getRecipientSettings(userIds: readonly string[]): Promise<Map<string, RecipientSettings>>;
  /** Every push subscription of `userIds`. */
  listDevices(userIds: readonly string[]): Promise<DeviceSubscription[]>;
  /** Deletes a subscription the push service reported gone (404 or 410). */
  deleteDevice(id: string): Promise<void>;
  /** Records a delivery to these subscriptions at `at`. */
  markDevicesDelivered(ids: readonly string[], at: Date): Promise<void>;
  /** Writes a claimed row's outcome and releases its lease. */
  finishNotification(id: string, outcome: NotificationOutcome): Promise<void>;
  /** Deletes `sent` and `skipped` rows created before `before`; returns how many. */
  deleteOldNotifications(before: Date): Promise<number>;
}
