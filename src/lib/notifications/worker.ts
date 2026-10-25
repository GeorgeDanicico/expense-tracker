import type { PushPayload, PushResult, PushSender } from "@/lib/notifications/push";
import type {
  ClaimedNotification,
  DeviceSubscription,
  DueCounts,
  NotificationOutcome,
  RecipientSettings,
  WorkerStore,
} from "@/lib/notifications/worker-store";

/** The heartbeat name of the notifications worker. */
export const WORKER_NAME = "worker";

/** How long the worker waits between the starts of two ticks. */
export const TICK_INTERVAL_MS = 30_000;

/** The most outbox rows one tick claims. */
export const NOTIFICATION_BATCH = 50;

/**
 * When a row whose push the push service throttled (429) or failed (5xx, no answer) is tried again,
 * after its first, second and third send: 1, 5 and 30 minutes. A fourth failure marks it `failed`.
 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/** `sent` and `skipped` rows older than this are deleted, once a day. */
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** How often the clean-up runs: on the first tick, then every 24 hours. */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

/** What `last_error` says for a recipient without a single registered browser. */
export const NO_DEVICES = "No devices: notifications aren't enabled on any browser.";
/** What `last_error` says when every one of the recipient's subscriptions turned out to be gone. */
export const ALL_DEVICES_GONE = "No devices: every subscription had expired and was deleted.";

const DEFAULT_SETTINGS: RecipientSettings = { pushEnabled: true, remindersEnabled: true, todosEnabled: true };
const MAX_ERROR_LENGTH = 500;

export type Clock = { now(): Date };

/** Structured log fields: one flat object per line. */
export type LogFields = Record<string, string | number | boolean | null>;

export interface WorkerLog {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** What the worker remembers between ticks (in memory: a restart runs the clean-up again). */
export type WorkerState = { lastCleanupAt: Date | null };

export function createWorkerState(): WorkerState {
  return { lastCleanupAt: null };
}

export type TickDependencies = {
  store: WorkerStore;
  /** Null when the VAPID keys are missing: nothing is claimed and the outbox waits. */
  push: PushSender | null;
  clock: Clock;
  log: WorkerLog;
  /** The build the worker runs (a git SHA or the package version), written with the heartbeat. */
  version: string;
  state: WorkerState;
};

/** How the claimed rows of one tick ended. */
export type DeliveryCounts = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  retried: number;
  /** Subscriptions deleted because their push service answered 404 or 410. */
  devicesRemoved: number;
};

/** What a tick did, or null when it failed (the failure is logged). */
export type TickResult =
  | { pushConfigured: true; delivery: DeliveryCounts; cleaned: number | null }
  | { pushConfigured: false; due: DueCounts }
  | null;

/** An error's message, without its stack or any attached request details. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncate(message: string) {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

/** The row's payload when it has the four strings a push needs, else null. Extra fields are dropped. */
export function pushPayload(payload: unknown): PushPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { title, body, url, tag } = payload as Record<string, unknown>;
  if ([title, body, url, tag].some((value) => typeof value !== "string") || !title) return null;
  return { title, body, url, tag } as PushPayload;
}

/**
 * Whether the recipient wants this kind of notification: the Browser notifications switch, then
 * the kind's own switch. A test needs only the first. Null for a kind this code doesn't know.
 */
export function kindAllowed(kind: string, settings: RecipientSettings): boolean | null {
  if (!settings.pushEnabled) return false;
  switch (kind) {
    case "test":
      return true;
    case "reminder":
      return settings.remindersEnabled;
    case "todo_assigned":
    case "todo_due":
      return settings.todosEnabled;
    default:
      return null;
  }
}

/** Why a switch turned the row into `skipped`. */
function skippedBecause(kind: string, settings: RecipientSettings) {
  if (!settings.pushEnabled) return "Skipped: Browser notifications are off.";
  return kind === "reminder" ? "Skipped: reminder notifications are off." : "Skipped: to-do notifications are off.";
}

/**
 * The row's outcome from the sends to each device (an empty list: the recipient had no devices).
 * Any retryable failure retries the whole row, to every device, while retries are left (the tag
 * makes a repeat replace the earlier notification). Otherwise one delivery is enough for `sent`.
 */
export function outcomeOf(row: Pick<ClaimedNotification, "attempts">, results: readonly PushResult[], now: Date): NotificationOutcome {
  if (results.length === 0) return { status: "skipped", attempts: row.attempts, lastError: NO_DEVICES };

  const attempts = row.attempts + 1;
  const errors = results.flatMap((result) => (result.outcome === "retry" || result.outcome === "rejected" ? [result.error] : []));
  const lastError = errors.length > 0 ? truncate([...new Set(errors)].join("; ")) : null;
  const retryable = results.some((result) => result.outcome === "retry");

  if (retryable && row.attempts < RETRY_DELAYS_MS.length) {
    return { status: "pending", attempts, sendAt: new Date(now.getTime() + RETRY_DELAYS_MS[row.attempts]), lastError: lastError! };
  }
  if (results.some((result) => result.outcome === "sent")) return { status: "sent", attempts, sentAt: now, lastError };
  if (results.every((result) => result.outcome === "gone")) return { status: "skipped", attempts, lastError: ALL_DEVICES_GONE };
  return { status: "failed", attempts, lastError: lastError ?? "Every device refused the notification." };
}

type Deliveries = { settings: Map<string, RecipientSettings>; devices: Map<string, DeviceSubscription[]> };

/** Sends one claimed row (or skips it) and writes its outcome. Counts into `counts`. */
async function deliver(row: ClaimedNotification, { settings, devices }: Deliveries, deps: TickDependencies & { push: PushSender }, counts: DeliveryCounts) {
  const { store, push, clock, log } = deps;
  const recipient = settings.get(row.userId) ?? DEFAULT_SETTINGS;
  const allowed = kindAllowed(row.kind, recipient);
  const payload = pushPayload(row.payload);

  let outcome: NotificationOutcome;
  if (allowed === null) {
    outcome = { status: "failed", attempts: row.attempts, lastError: `Unknown notification kind "${truncate(row.kind)}".` };
  } else if (!allowed) {
    outcome = { status: "skipped", attempts: row.attempts, lastError: skippedBecause(row.kind, recipient) };
  } else if (!payload) {
    outcome = { status: "failed", attempts: row.attempts, lastError: "Invalid payload: it needs a title, body, url and tag." };
  } else {
    const targets = devices.get(row.userId) ?? [];
    const results = await Promise.all(targets.map((device) => push.send(device, payload)));
    const at = clock.now();
    const delivered = targets.filter((_, index) => results[index].outcome === "sent").map((device) => device.id);
    const gone = targets.filter((_, index) => results[index].outcome === "gone");
    for (const device of gone) {
      try {
        await store.deleteDevice(device.id);
        counts.devicesRemoved++;
      } catch (error) {
        log.error("device_delete_failed", { subscription: device.id, error: errorMessage(error) });
      }
    }
    // Later rows for this user this tick don't try the deleted devices again.
    if (gone.length > 0) devices.set(row.userId, targets.filter((device) => !gone.includes(device)));
    if (delivered.length > 0) await store.markDevicesDelivered(delivered, at);
    outcome = outcomeOf(row, results, at);
  }

  await store.finishNotification(row.id, outcome);
  if (outcome.status === "pending") counts.retried++;
  else counts[outcome.status]++;
  if (outcome.status !== "sent") {
    log.info("notification", { id: row.id, kind: truncate(row.kind), status: outcome.status, attempts: outcome.attempts, error: outcome.lastError });
  }
}

/** Claims due outbox rows and delivers each one. A failure on one row is logged and the rest go on. */
async function deliverDue(deps: TickDependencies & { push: PushSender }): Promise<DeliveryCounts> {
  const { store, log } = deps;
  const counts: DeliveryCounts = { claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0, devicesRemoved: 0 };
  const rows = await store.claimNotifications(NOTIFICATION_BATCH);
  counts.claimed = rows.length;
  if (rows.length === 0) return counts;

  const userIds = [...new Set(rows.map((row) => row.userId))];
  const [settings, deviceList] = await Promise.all([store.getRecipientSettings(userIds), store.listDevices(userIds)]);
  const devices = new Map<string, DeviceSubscription[]>();
  for (const device of deviceList) devices.set(device.userId, [...(devices.get(device.userId) ?? []), device]);

  for (const row of rows) {
    try {
      await deliver(row, { settings, devices }, deps, counts);
    } catch (error) {
      // The lease runs out and the row is claimed again in 2 minutes.
      log.error("notification_failed", { id: row.id, error: errorMessage(error) });
    }
  }
  return counts;
}

/** Deletes old `sent` and `skipped` rows on the first tick and then once every 24 hours. */
async function cleanUp({ store, clock, log, state }: TickDependencies): Promise<number | null> {
  const now = clock.now();
  if (state.lastCleanupAt && now.getTime() - state.lastCleanupAt.getTime() < CLEANUP_INTERVAL_MS) return null;
  try {
    const deleted = await store.deleteOldNotifications(new Date(now.getTime() - NOTIFICATION_RETENTION_MS));
    state.lastCleanupAt = now;
    log.info("cleanup", { deleted });
    return deleted;
  } catch (error) {
    // Tried again next tick.
    log.error("cleanup_failed", { error: errorMessage(error) });
    return null;
  }
}

/**
 * One pass of the worker: the heartbeat, the daily clean-up, then up to {@link NOTIFICATION_BATCH}
 * outbox rows sent to every device of their recipient. Without VAPID keys (`push` null) it only
 * logs `push_not_configured` with how many rows are waiting, and leaves them pending.
 * It never throws: a failure is logged as one `tick_failed` line and the next tick tries again.
 */
export async function tick(deps: TickDependencies): Promise<TickResult> {
  const { store, push, clock, log, version } = deps;
  const startedAt = clock.now();
  try {
    await store.writeHeartbeat({ name: WORKER_NAME, beatAt: startedAt, version });

    if (!push) {
      const due = await store.countDue(startedAt);
      log.error("push_not_configured", {
        error: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to send notifications; outbox rows stay pending.",
        dueNotifications: due.notifications,
        dueReminders: due.reminders,
      });
      return { pushConfigured: false, due };
    }

    const cleaned = await cleanUp(deps);
    const delivery = await deliverDue({ ...deps, push });
    log.info("tick", { ...delivery, ms: clock.now().getTime() - startedAt.getTime() });
    return { pushConfigured: true, delivery, cleaned };
  } catch (error) {
    log.error("tick_failed", { error: errorMessage(error), ms: clock.now().getTime() - startedAt.getTime() });
    return null;
  }
}
