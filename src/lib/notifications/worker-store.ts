import type { NotifiableReminder } from "@/lib/reminders/notification";

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

/**
 * A reminder the worker has claimed (`claim_due_reminders`): its schedule as stored, with the
 * values that tell whether it changed since the claim.
 */
export type ClaimedReminder = NotifiableReminder & {
  userId: string;
  /** The stored `next_notify_at` the claim found due. */
  nextNotifyAt: Date;
  /** `updated_at` as the claim left it; any later edit, mark done or snooze changes it. */
  updatedAt: string;
  /** The lease the claim set (`notify_locked_until`). */
  lockedUntil: string;
};

/** A notification the worker queues itself (a reminder's), deduplicated by `dedupeKey`. */
export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  payload: { title: string; body: string; url: string; tag: string };
  dedupeKey: string;
};

/** An open (not done) to-do card due on a given day, with its assignee's user. */
export type DueTodo = {
  id: string;
  title: string;
  /** The `user_id` of the card's assignee (`todos.assignee_member_id` → `family_members`). */
  assigneeUserId: string;
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
  /**
   * Leases up to `batch` unmuted reminders whose `next_notify_at` has passed for 2 minutes
   * (`claim_due_reminders`) and returns them.
   */
  claimDueReminders(batch: number): Promise<ClaimedReminder[]>;
  /**
   * Inserts a pending outbox row to send now. `duplicate` when a row with its `dedupeKey` already
   * exists (an earlier run queued it), which is not an error.
   */
  enqueueNotification(notification: NewNotification): Promise<"queued" | "duplicate">;
  /**
   * Stores `nextNotifyAt` on a claimed reminder and releases its lease, only while it is as
   * claimed: the same `updated_at`, not muted and with an open occurrence. Otherwise it leaves the
   * reminder alone, apart from releasing this claim's lease if it still holds, and answers
   * `changed`: an edit, mark done or snooze in between already stored its own `next_notify_at`.
   */
  advanceReminder(reminder: ClaimedReminder, nextNotifyAt: Date | null): Promise<"advanced" | "changed">;
  /**
   * Every card in any family whose `due_date` is `date` (`YYYY-MM-DD`), whose status isn't `done`
   * and which has an assignee, with that assignee's user.
   */
  listOpenTodosDueOn(date: string): Promise<DueTodo[]>;
}
