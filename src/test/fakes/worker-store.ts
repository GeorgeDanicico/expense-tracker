import type {
  ClaimedNotification,
  DeviceSubscription,
  DueCounts,
  Heartbeat,
  NotificationOutcome,
  RecipientSettings,
  WorkerStore,
} from "@/lib/notifications/worker-store";

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
};

export type FakeDevice = DeviceSubscription & { lastSuccessAt: Date | null };

const LEASE_MS = 2 * 60_000;

/**
 * In-memory `WorkerStore`. `heartbeats` holds the latest beat by name and `due` is what `countDue`
 * answers. `notifications`, `settings` and `devices` are the outbox, the switches and the
 * subscriptions; `claimNotifications` leases due pending rows at `now()` like the SQL function.
 * `failWith` makes every call reject with that error.
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
  failWith: Error | null = null;
  now: () => Date = () => new Date();
  private nextId = 1;

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

  async deleteOldNotifications(before: Date) {
    this.check();
    this.cleanups.push(before);
    const kept = this.notifications.filter((row) => !(["sent", "skipped"].includes(row.status) && row.createdAt < before));
    const deleted = this.notifications.length - kept.length;
    this.notifications = kept;
    return deleted;
  }
}
