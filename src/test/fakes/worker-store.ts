import type {
  ClaimedNotification,
  ClaimedReminder,
  DeviceSubscription,
  DueCounts,
  Heartbeat,
  NewNotification,
  NotificationOutcome,
  RecipientSettings,
  WorkerStore,
} from "@/lib/notifications/worker-store";
import { nextNotifyAt, nextOccurrenceAfter } from "@/lib/reminders/schedule";
import type { ReminderSchedule } from "@/lib/reminders/types";

/** An outbox row as the fake keeps it. */
export type FakeNotification = {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  status: "pending" | "sent" | "skipped" | "failed";
  attempts: number;
  sendAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  lockedUntil: Date | null;
  createdAt: Date;
  dedupeKey?: string | null;
};

/** A reminder as the fake keeps it: its schedule plus the worker's columns. */
export type FakeReminder = ReminderSchedule & {
  id: string;
  userId: string;
  title: string;
  nextNotifyAt: Date | null;
  /** Changes on every write, the claim included, like the `reminders_guard` trigger. */
  updatedAt: string;
  lockedUntil: Date | null;
};

export type FakeDevice = DeviceSubscription & { lastSuccessAt: Date | null };

const LEASE_MS = 2 * 60_000;

/**
 * In-memory `WorkerStore`. `heartbeats` holds the latest beat by name and `due` is what `countDue`
 * answers. `notifications`, `settings` and `devices` are the outbox, the switches and the
 * subscriptions; `claimNotifications` leases due pending rows at `now()` like the SQL function.
 * `reminders` are leased by `claimDueReminders` like `claim_due_reminders`, and `addReminder`,
 * `completeReminder`, `snoozeReminder` and `editReminder` write them as the reminders service does.
 * `failWith` makes every call reject with that error; `beforeAdvance` runs inside
 * `advanceReminder` before it checks the reminder (an edit racing the worker, or a crash).
 */
export class FakeWorkerStore implements WorkerStore {
  heartbeats = new Map<string, Heartbeat>();
  due: DueCounts = { notifications: 0, reminders: 0 };
  countedAt: Date[] = [];
  notifications: FakeNotification[] = [];
  settings = new Map<string, RecipientSettings>();
  devices: FakeDevice[] = [];
  /** Cut-offs `deleteOldNotifications` was called with. */
  cleanups: Date[] = [];
  reminders: FakeReminder[] = [];
  failWith: Error | null = null;
  beforeAdvance: ((reminder: ClaimedReminder) => void) | null = null;
  now: () => Date = () => new Date();
  private nextId = 1;
  private writes = 0;

  private stamp() {
    return `${this.now().toISOString()}#${++this.writes}`;
  }

  /**
   * Adds a reminder (defaults: a one-off today at 09:00 in Bucharest, notifying at the time) as
   * `createReminder` saves it at `now()`; returns it.
   */
  addReminder(
    values: Partial<Omit<FakeReminder, "nextNotifyAt" | "updatedAt" | "lockedUntil">> & Pick<FakeReminder, "userId" | "startsOn">,
  ): FakeReminder {
    const reminder: FakeReminder = {
      id: `r${this.nextId++}`,
      title: "Pay rent",
      timeOfDay: "09:00",
      timezone: "Europe/Bucharest",
      repeatUnit: "none",
      repeatInterval: 1,
      leadMinutes: [0],
      notificationsMuted: false,
      nextDueOn: values.startsOn,
      snoozedUntil: null,
      ...values,
      nextNotifyAt: null,
      updatedAt: "",
      lockedUntil: null,
    };
    this.reschedule(reminder);
    this.reminders.push(reminder);
    return reminder;
  }

  private reminder(id: string) {
    const reminder = this.reminders.find((candidate) => candidate.id === id);
    if (!reminder) throw new Error(`No reminder ${id}`);
    return reminder;
  }

  /** Works out `nextNotifyAt` at `now()` and records a write, as every service write does. */
  private reschedule(reminder: FakeReminder) {
    reminder.nextNotifyAt = nextNotifyAt(reminder, this.now());
    reminder.updatedAt = this.stamp();
  }

  /** Marks the open occurrence done, as `completeReminder` does. */
  completeReminder(id: string) {
    const reminder = this.reminder(id);
    reminder.nextDueOn = reminder.nextDueOn === null ? null : nextOccurrenceAfter(reminder, reminder.nextDueOn);
    reminder.snoozedUntil = null;
    this.reschedule(reminder);
  }

  /** Snoozes the open occurrence until `until`, as `snoozeReminder` does. */
  snoozeReminder(id: string, until: Date) {
    const reminder = this.reminder(id);
    reminder.snoozedUntil = until.toISOString();
    this.reschedule(reminder);
  }

  /** Changes fields and works the notify time out again, as `updateReminder` does (dates aside). */
  editReminder(id: string, values: Partial<Pick<FakeReminder, "title" | "leadMinutes" | "notificationsMuted" | "timeOfDay">>) {
    const reminder = this.reminder(id);
    Object.assign(reminder, values);
    this.reschedule(reminder);
  }

  /** The `reminder` outbox rows, oldest first. */
  reminderNotifications() {
    return this.notifications.filter((row) => row.kind === "reminder");
  }

  /** Queues a pending outbox row (send now unless `sendAt` says otherwise); returns it. */
  queue(row: Partial<FakeNotification> & Pick<FakeNotification, "userId">): FakeNotification {
    const created: FakeNotification = {
      id: `n${this.nextId++}`,
      kind: "test",
      payload: { title: "Test notification", body: "Notifications work on this device.", url: "/settings/notifications", tag: "test" },
      status: "pending",
      attempts: 0,
      sendAt: this.now(),
      sentAt: null,
      lastError: null,
      lockedUntil: null,
      createdAt: this.now(),
      ...row,
    };
    this.notifications.push(created);
    return created;
  }

  /** Adds a device for `userId`; returns it. */
  addDevice(userId: string, endpoint = `https://push.example.test/${this.nextId}`): FakeDevice {
    const device: FakeDevice = { id: `d${this.nextId++}`, userId, endpoint, p256dh: "p256dh", auth: "auth", lastSuccessAt: null };
    this.devices.push(device);
    return device;
  }

  private check() {
    if (this.failWith) throw this.failWith;
  }

  async writeHeartbeat(heartbeat: Heartbeat) {
    this.check();
    this.heartbeats.set(heartbeat.name, heartbeat);
  }

  async countDue(now: Date) {
    this.check();
    this.countedAt.push(now);
    return this.due;
  }

  async claimNotifications(batch: number): Promise<ClaimedNotification[]> {
    this.check();
    const now = this.now();
    const claimed = this.notifications
      .filter((row) => row.status === "pending" && row.sendAt <= now && (!row.lockedUntil || row.lockedUntil <= now))
      .sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime())
      .slice(0, Math.max(batch, 0));
    for (const row of claimed) row.lockedUntil = new Date(now.getTime() + LEASE_MS);
    return claimed.map(({ id, userId, kind, payload, attempts }) => ({ id, userId, kind, payload, attempts }));
  }

  async getRecipientSettings(userIds: readonly string[]) {
    this.check();
    return new Map([...this.settings].filter(([userId]) => userIds.includes(userId)));
  }

  async listDevices(userIds: readonly string[]) {
    this.check();
    return this.devices
      .filter((device) => userIds.includes(device.userId))
      .map(({ id, userId, endpoint, p256dh, auth }) => ({ id, userId, endpoint, p256dh, auth }));
  }

  async deleteDevice(id: string) {
    this.check();
    this.devices = this.devices.filter((device) => device.id !== id);
  }

  async markDevicesDelivered(ids: readonly string[], at: Date) {
    this.check();
    for (const device of this.devices) if (ids.includes(device.id)) device.lastSuccessAt = at;
  }

  async finishNotification(id: string, outcome: NotificationOutcome) {
    this.check();
    const row = this.notifications.find((notification) => notification.id === id);
    if (!row) throw new Error(`No notification ${id}`);
    Object.assign(row, { status: outcome.status, attempts: outcome.attempts, lastError: outcome.lastError, lockedUntil: null });
    if (outcome.status === "pending") row.sendAt = outcome.sendAt;
    if (outcome.status === "sent") row.sentAt = outcome.sentAt;
  }

  async claimDueReminders(batch: number): Promise<ClaimedReminder[]> {
    this.check();
    const now = this.now();
    const claimed = this.reminders
      .filter((reminder) => reminder.nextNotifyAt !== null && reminder.nextNotifyAt <= now && !reminder.notificationsMuted)
      .filter((reminder) => !reminder.lockedUntil || reminder.lockedUntil <= now)
      .sort((a, b) => a.nextNotifyAt!.getTime() - b.nextNotifyAt!.getTime())
      .slice(0, Math.max(batch, 0));
    for (const reminder of claimed) {
      reminder.lockedUntil = new Date(now.getTime() + LEASE_MS);
      reminder.updatedAt = this.stamp();
    }
    return claimed.map((reminder) => ({
      ...reminder,
      leadMinutes: [...reminder.leadMinutes],
      nextNotifyAt: reminder.nextNotifyAt!,
      lockedUntil: reminder.lockedUntil!.toISOString(),
    }));
  }

  async enqueueNotification({ userId, kind, payload, dedupeKey }: NewNotification) {
    this.check();
    if (this.notifications.some((row) => row.dedupeKey === dedupeKey)) return "duplicate" as const;
    this.queue({ userId, kind, payload, dedupeKey });
    return "queued" as const;
  }

  async advanceReminder(claimed: ClaimedReminder, next: Date | null) {
    this.check();
    this.beforeAdvance?.(claimed);
    const reminder = this.reminders.find((candidate) => candidate.id === claimed.id);
    if (!reminder) return "changed" as const;
    if (reminder.updatedAt !== claimed.updatedAt || reminder.notificationsMuted || reminder.nextDueOn === null) {
      if (reminder.lockedUntil?.toISOString() === claimed.lockedUntil) {
        reminder.lockedUntil = null;
        reminder.updatedAt = this.stamp();
      }
      return "changed" as const;
    }
    reminder.nextNotifyAt = next;
    reminder.lockedUntil = null;
    reminder.updatedAt = this.stamp();
    return "advanced" as const;
  }

  async deleteOldNotifications(before: Date) {
    this.check();
    this.cleanups.push(before);
    const kept = this.notifications.filter((row) => !(["sent", "skipped"].includes(row.status) && row.createdAt < before));
    const deleted = this.notifications.length - kept.length;
    this.notifications = kept;
    return deleted;
  }
}
