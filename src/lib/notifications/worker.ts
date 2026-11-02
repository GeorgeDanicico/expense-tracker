import { APPLICATION_TIMEZONE } from "@/lib/calendar";
import type { LogFields } from "@/lib/log";
import { runWithRequestContext, type RequestContext } from "@/lib/log/request-context";
import { createRequestId } from "@/lib/log/request-id";
import { spanSummary } from "@/lib/log/span";
import type { PushPayload, PushResult, PushSender } from "@/lib/notifications/push";
import { eventAddedPayload, eventDedupeKey, eventPayload } from "@/lib/family-calendar/notification";
import { planReminderNotification } from "@/lib/reminders/notification";
import { utcToZoned } from "@/lib/time-zone";
import type {
  ClaimedEvent,
  ClaimedNotification,
  ClaimedReminder,
  DeviceSubscription,
  DueCounts,
  DueTodo,
  NewNotification,
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

/** The most due reminders one tick claims. */
export const REMINDER_BATCH = 50;

/** The most due calendar events one tick claims. */
export const EVENT_BATCH = 50;

/**
 * When a row whose push the push service throttled (429) or failed (5xx, no answer) is tried again,
 * after its first, second and third send: 1, 5 and 30 minutes. A fourth failure marks it `failed`.
 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

/** A tick that takes longer than this is logged at `warn` with `slow: true`. */
export const SLOW_TICK_MS = 10_000;

/**
 * How long the worker remembers a notification it pushed but couldn't mark finished (B9): the
 * lease is 2 minutes and a lapsed row is claimed again on the next tick, so this covers the lease,
 * several ticks after it and a slow tick.
 */
export const PUSHED_MEMORY_MS = 10 * 60_000;

/** The most notification ids that memory holds; past it the oldest are forgotten first. */
export const PUSHED_MEMORY_MAX = 1000;

/** `sent` and `skipped` rows older than this are deleted, once a day. */
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60_000;
/**
 * How often each clean-up step runs: on the first tick, then every 24 hours. The purge of expired
 * statement-import drafts keeps its own clock, so a failing step is retried next tick without
 * repeating the other.
 */
export const CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * The Bucharest wall-clock time from which the day's "Due today" to-do notifications go out: the
 * first tick at or after it queues them.
 */
export const TODO_DUE_TIME = "09:00";

/** What `last_error` says for a recipient without a single registered browser. */
export const NO_DEVICES = "No devices: notifications aren't enabled on any browser.";
/** What `last_error` says when every one of the recipient's subscriptions turned out to be gone. */
export const ALL_DEVICES_GONE = "No devices: every subscription had expired and was deleted.";

const DEFAULT_SETTINGS: RecipientSettings = { pushEnabled: true, remindersEnabled: true, todosEnabled: true, calendarEnabled: true };
const MAX_ERROR_LENGTH = 500;

export type Clock = { now(): Date };

/** Structured log fields (the shared logger's, `src/lib/log`). */
export type { LogFields };

export interface WorkerLog {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/**
 * What the worker remembers between ticks (in memory: a restart runs the clean-up again, and
 * queues the day's due to-dos again, which their dedupe keys turn into no-ops).
 */
export type WorkerState = {
  lastCleanupAt: Date | null;
  /** When the expired import drafts were last purged. */
  lastImportPurgeAt: Date | null;
  /** The Bucharest date whose "Due today" to-do notifications were all queued. */
  lastTodoDueOn: string | null;
  /**
   * Outbox rows whose push reached a device but whose outcome couldn't be written, by id, with when
   * they were pushed (oldest first). A row claimed again while it's here is finished as `sent`
   * instead of being pushed a second time (see {@link rememberPushed}).
   */
  pushed: Map<string, number>;
};

export function createWorkerState(): WorkerState {
  return { lastCleanupAt: null, lastImportPurgeAt: null, lastTodoDueOn: null, pushed: new Map() };
}

/** Remembers that `id` was pushed at `now` and its outcome wasn't saved; forgets expired ids and, past the cap, the oldest. */
function rememberPushed(state: WorkerState, id: string, now: Date) {
  state.pushed.delete(id);
  state.pushed.set(id, now.getTime());
  for (const [oldId, at] of state.pushed) {
    if (state.pushed.size <= PUSHED_MEMORY_MAX && now.getTime() - at < PUSHED_MEMORY_MS) break;
    state.pushed.delete(oldId);
  }
}

/** Whether `id` is remembered as pushed within {@link PUSHED_MEMORY_MS}. */
function wasPushed(state: WorkerState, id: string, now: Date) {
  const at = state.pushed.get(id);
  return at !== undefined && now.getTime() - at < PUSHED_MEMORY_MS;
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

/** How the claimed reminders of one tick ended. */
export type ReminderCounts = {
  claimed: number;
  /** Outbox rows inserted. */
  queued: number;
  /** Notify times an earlier run had already queued (same dedupe key). */
  duplicates: number;
  /** Reminders edited, marked done, snoozed or muted since the claim; left as they are. */
  changed: number;
};

/** How the claimed calendar events of one tick ended. */
export type EventCounts = {
  claimed: number;
  /** Outbox rows inserted, one per attendee. */
  queued: number;
  /** Rows an earlier run had already queued (same dedupe key). */
  duplicates: number;
  /** Events edited since the claim (a new notify time); left for their new time. */
  changed: number;
};

/** What the daily "Due today" run queued, when it ran this tick. */
export type TodoDueCounts = {
  /** The Bucharest date it ran for. */
  date: string;
  /** Open, assigned cards due that day. */
  found: number;
  /** Outbox rows inserted. */
  queued: number;
  /** Cards an earlier run (before a restart, or a failed run) had already queued. */
  duplicates: number;
  /** Cards whose row couldn't be inserted; the whole day is tried again next tick. */
  failed: number;
};

/** What a tick did, or null when it failed (the failure is logged). */
export type TickResult =
  | {
      pushConfigured: true;
      reminders: ReminderCounts;
      events: EventCounts;
      delivery: DeliveryCounts;
      cleaned: number | null;
      /** Expired import drafts deleted, or null on a tick that didn't purge or whose purge failed. */
      importsPurged: number | null;
      /** Null on every tick but the one that ran the day's "Due today" notifications. */
      todosDue: TodoDueCounts | null;
    }
  | { pushConfigured: false; due: DueCounts; cleaned: number | null; importsPurged: number | null }
  | null;

/** An error's message, without its stack or any attached request details. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncate(message: string) {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

/**
 * The row's payload when it has the four strings a push needs, else null. Extra fields are dropped.
 *
 * `todo_assigned` rows are sent as the `todos_notify_assignee` trigger wrote them ("Ana assigned
 * you", the card title, `/todos?card=<id>`, `todo:<id>`), not reformatted here: the payload is
 * already what the notification shows, and its extra `todoId`, `todoTitle` and `assignerName`
 * fields are dropped by this function. `event_added` rows are the exception: {@link payloadFor}
 * words their body from those extra fields.
 */
export function pushPayload(payload: unknown): PushPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { title, body, url, tag } = payload as Record<string, unknown>;
  if ([title, body, url, tag].some((value) => typeof value !== "string") || !title) return null;
  return { title, body, url, tag } as PushPayload;
}

/**
 * What to send for a row: {@link pushPayload}, except that an `event_added` row's body (the
 * trigger stores just the event's title) is reworded as "Visit my parents, Sat 1 Nov" or
 * "Swimming, Tue 3 Nov, every week for 6 weeks" from the payload's extra fields, as of `now`.
 */
export function payloadFor(kind: string, payload: unknown, now: Date): PushPayload | null {
  const plain = pushPayload(payload);
  if (!plain || kind !== "event_added") return plain;
  return eventAddedPayload(payload, now) ?? plain;
}

/**
 * Whether the recipient wants this kind of notification: the Browser notifications switch, then
 * the kind's own switch. A test and an AI budget warning need only the first. Null for a kind this code doesn't know.
 */
export function kindAllowed(kind: string, settings: RecipientSettings): boolean | null {
  if (!settings.pushEnabled) return false;
  switch (kind) {
    case "test":
    case "ai_budget":
      return true;
    case "reminder":
      return settings.remindersEnabled;
    case "todo_assigned":
    case "todo_due":
      return settings.todosEnabled;
    case "event":
    case "event_added":
      return settings.calendarEnabled;
    default:
      return null;
  }
}

/** Why a switch turned the row into `skipped`. */
function skippedBecause(kind: string, settings: RecipientSettings) {
  if (!settings.pushEnabled) return "Skipped: Browser notifications are off.";
  if (kind === "reminder") return "Skipped: reminder notifications are off.";
  if (kind === "event" || kind === "event_added") return "Skipped: calendar notifications are off.";
  return "Skipped: to-do notifications are off.";
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

/**
 * Writes the outcome of a row that reached a device. The push can't be taken back, so a failure
 * here must not fail the row (B9): the write is tried once more, and if that fails too it's logged
 * as `notification_bookkeeping_failed` and the id is remembered in `state.pushed`, so the claim
 * that follows the lease finishes the row instead of pushing it again. A write that succeeds
 * forgets the id.
 */
async function finishAfterPush(row: ClaimedNotification, outcome: NotificationOutcome, { store, clock, log, state }: TickDependencies) {
  try {
    await store.finishNotification(row.id, outcome);
  } catch (firstError) {
    log.warn("notification_bookkeeping_retry", { id: row.id, write: "finishNotification", error: errorMessage(firstError) });
    try {
      await store.finishNotification(row.id, outcome);
    } catch (error) {
      log.error("notification_bookkeeping_failed", { id: row.id, write: "finishNotification", error: errorMessage(error) });
      rememberPushed(state, row.id, clock.now());
      return;
    }
  }
  state.pushed.delete(row.id);
}

/** Sends one claimed row (or skips it) and writes its outcome. Counts into `counts`. */
async function deliver(row: ClaimedNotification, { settings, devices }: Deliveries, deps: TickDependencies & { push: PushSender }, counts: DeliveryCounts) {
  const { store, push, clock, log, state } = deps;
  const recipient = settings.get(row.userId) ?? DEFAULT_SETTINGS;
  const allowed = kindAllowed(row.kind, recipient);
  const payload = payloadFor(row.kind, row.payload, clock.now());

  let outcome: NotificationOutcome;
  // Whether at least one device received the push: from then on a failed write must not fail the row.
  let pushed = false;
  if (wasPushed(state, row.id, clock.now())) {
    // An earlier tick pushed this row but couldn't save that: finish it without pushing again.
    pushed = true;
    outcome = { status: "sent", attempts: row.attempts + 1, sentAt: clock.now(), lastError: null };
    log.warn("notification_resend_skipped", { id: row.id, kind: truncate(row.kind) });
  } else if (allowed === null) {
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
    if (delivered.length > 0) {
      pushed = true;
      try {
        await store.markDevicesDelivered(delivered, at);
      } catch (error) {
        // Only the devices' last-success time is lost; the row is still finished below.
        log.error("notification_bookkeeping_failed", { id: row.id, write: "markDevicesDelivered", error: errorMessage(error) });
      }
    }
    outcome = outcomeOf(row, results, at);
  }

  if (pushed) await finishAfterPush(row, outcome, deps);
  else await store.finishNotification(row.id, outcome);
  if (outcome.status === "pending") counts.retried++;
  else counts[outcome.status]++;
  if (outcome.status !== "sent") {
    // A retried row is an expected, temporary failure: `warn`, not `info`.
    log[outcome.status === "pending" ? "warn" : "info"]("notification", {
      id: row.id,
      kind: truncate(row.kind),
      status: outcome.status,
      attempts: outcome.attempts,
      error: outcome.lastError,
    });
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

/**
 * Claims due reminders and, for each, queues one `reminder` outbox row for the latest notify time
 * it missed, then stores its next notify time. Claim, queue, advance: a crash after queueing
 * leaves `next_notify_at` as it was, and the re-run after the lease queues the same dedupe key,
 * which is a no-op, so a notification is never lost nor sent twice. The advance only applies to a
 * reminder that hasn't changed since the claim. A failure on one reminder is logged and the rest
 * go on; its lease runs out and it's claimed again. A claim that fails as a whole is logged as
 * `reminder_claim_failed` and counts as no reminders, so the events, to-dos and deliveries still
 * run, as with `event_claim_failed`.
 */
async function queueDueReminders({ store, clock, log }: TickDependencies): Promise<ReminderCounts> {
  const counts: ReminderCounts = { claimed: 0, queued: 0, duplicates: 0, changed: 0 };
  let reminders: ClaimedReminder[];
  try {
    reminders = await store.claimDueReminders(REMINDER_BATCH);
  } catch (error) {
    // A database error may be momentary and must not skip the tick's deliveries (B9).
    log.error("reminder_claim_failed", { error: errorMessage(error) });
    return counts;
  }
  counts.claimed = reminders.length;

  for (const reminder of reminders) {
    try {
      const plan = planReminderNotification(reminder, reminder.nextNotifyAt, clock.now());
      if (plan.notification) {
        const result = await store.enqueueNotification({
          userId: reminder.userId,
          kind: "reminder",
          payload: plan.notification.payload,
          dedupeKey: plan.notification.dedupeKey,
        });
        if (result === "queued") counts.queued++;
        else counts.duplicates++;
      }
      if ((await store.advanceReminder(reminder, plan.nextNotifyAt)) === "changed") counts.changed++;
    } catch (error) {
      log.error("reminder_failed", { id: reminder.id, error: errorMessage(error) });
    }
  }
  return counts;
}

/**
 * Claims due calendar events and, for each, queues one `event` outbox row per attendee, then marks
 * it notified. Claim, queue, mark: a crash after queueing leaves `notified_at` empty, and the
 * re-run after the lease queues the same dedupe keys (`event:<id>:<notify_at>:<user>`), which are
 * no-ops, so nobody is notified twice. The mark only applies while the event's `notify_at` is the
 * claim's: an edit in between has stored a new time and cleared `notified_at` for it. An event that
 * already ended is never returned by the claim (the claim marks it notified), and a failure on one
 * event (some row not queued) is logged and leaves it unmarked for the re-claim. A claim that fails
 * as a whole is logged as `event_claim_failed` and counts as no events, so the rest of the tick
 * (reminders, to-dos, delivery) still runs.
 */
async function queueDueEvents({ store, clock, log }: TickDependencies): Promise<EventCounts> {
  const counts: EventCounts = { claimed: 0, queued: 0, duplicates: 0, changed: 0 };
  let events: ClaimedEvent[];
  try {
    events = await store.claimDueCalendarEvents(EVENT_BATCH);
  } catch (error) {
    // The calendar must not stop reminders, to-dos and delivery: the claim function is missing
    // until the calendar migration is applied, and a database error may be momentary.
    log.error("event_claim_failed", { error: errorMessage(error) });
    return counts;
  }
  counts.claimed = events.length;

  for (const event of events) {
    try {
      const payload = eventPayload(event, clock.now());
      for (const userId of event.attendeeUserIds) {
        const result = await store.enqueueNotification({
          userId,
          kind: "event",
          payload,
          dedupeKey: eventDedupeKey(event.id, event.notifyAt, userId),
        });
        if (result === "queued") counts.queued++;
        else counts.duplicates++;
      }
      if ((await store.markEventNotified(event, clock.now())) === "changed") counts.changed++;
    } catch (error) {
      log.error("event_failed", { id: event.id, error: errorMessage(error) });
    }
  }
  return counts;
}

/** The "Due today" outbox row for an open card due on `date` (a Bucharest date). */
export function todoDueNotification(todo: DueTodo, date: string): NewNotification {
  return {
    userId: todo.assigneeUserId,
    kind: "todo_due",
    payload: { title: "Due today", body: todo.title, url: `/todos?card=${todo.id}`, tag: `todo:${todo.id}` },
    dedupeKey: `todo_due:${todo.id}:${date}`,
  };
}

/**
 * Once a day, on the first tick at or after {@link TODO_DUE_TIME} in Bucharest, queues a
 * `todo_due` row for each open (not done) card due that day with an assignee. Only today's cards:
 * a worker that was down all of yesterday never sends yesterday's. A worker that starts later in
 * the day still sends today's. The day counts as done only when every card was queued (or already
 * was); otherwise the next tick runs it again, and the dedupe keys keep the queued ones from
 * repeating. A restart forgets the day and runs it again, which the dedupe keys make a no-op.
 */
async function queueDueTodos({ store, clock, log, state }: TickDependencies): Promise<TodoDueCounts | null> {
  const local = utcToZoned(clock.now(), APPLICATION_TIMEZONE);
  if (local.time < TODO_DUE_TIME || state.lastTodoDueOn === local.date) return null;

  const counts: TodoDueCounts = { date: local.date, found: 0, queued: 0, duplicates: 0, failed: 0 };
  let todos: DueTodo[];
  try {
    todos = await store.listOpenTodosDueOn(local.date);
  } catch (error) {
    log.error("todos_due_failed", { date: local.date, error: errorMessage(error) });
    return null;
  }
  counts.found = todos.length;

  for (const todo of todos) {
    try {
      const result = await store.enqueueNotification(todoDueNotification(todo, local.date));
      if (result === "queued") counts.queued++;
      else counts.duplicates++;
    } catch (error) {
      counts.failed++;
      log.error("todo_due_failed", { id: todo.id, error: errorMessage(error) });
    }
  }
  if (counts.failed === 0) state.lastTodoDueOn = local.date;
  log.info("todos_due", counts);
  return counts;
}

/** Deletes old `sent` and `skipped` rows on the first tick and then once every 24 hours. */
async function cleanUpNotifications({ store, clock, log, state }: TickDependencies): Promise<number | null> {
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
 * Deletes the expired statement-import drafts of every user (`purge_expired_import_batches`) on
 * the first tick and then once every 24 hours. Drafts expire after 24 hours and every read already
 * treats an expired one as missing, so this only frees the rows. A failure (the function is missing
 * until the import migration is applied, or the database errors) is logged and tried again next
 * tick; it never stops the rest of the tick. The log carries the count of drafts and nothing from
 * them, and an error's message is the database's, never a row.
 */
async function purgeImportDrafts({ store, clock, log, state }: TickDependencies): Promise<number | null> {
  const now = clock.now();
  if (state.lastImportPurgeAt && now.getTime() - state.lastImportPurgeAt.getTime() < CLEANUP_INTERVAL_MS) return null;
  try {
    const purged = await store.purgeExpiredImportBatches();
    state.lastImportPurgeAt = now;
    log.info("import_drafts_purged", { purged });
    return purged;
  } catch (error) {
    log.error("import_drafts_purge_failed", { error: errorMessage(error) });
    return null;
  }
}

/**
 * One pass of the worker: the heartbeat, the daily clean-up (old outbox rows, expired import
 * drafts), the daily "Due today" to-do rows
 * (from 09:00 Bucharest), up to {@link REMINDER_BATCH} due
 * reminders queued as outbox rows, up to {@link EVENT_BATCH} due calendar events queued as one
 * outbox row per attendee, then up to {@link NOTIFICATION_BATCH} outbox rows sent to every
 * device of their recipient. Without VAPID keys (`push` null) it still runs the clean-up and the
 * draft purge (neither needs push), then only logs `push_not_configured`
 * with how many rows are waiting, and leaves them pending; reminders and events aren't claimed
 * either, and once the keys are set each reminder sends only its latest missed notify time (an
 * event whose end passed meanwhile sends nothing).
 * It never throws: a failure is logged as one `tick_failed` line and the next tick tries again.
 *
 * The tick runs in a context of its own, `{ requestId: "tick-<12 characters>", route: "worker.tick" }`
 * (see `src/lib/log/request-context.ts`), so every line it writes has that `requestId`, and the
 * `tick` line lists its `spans` (each Supabase call and push send), the `dbMs` and `dbCalls` they add
 * up to and, over {@link SLOW_TICK_MS}, `slow: true` at `warn` with the `slowestSpan`.
 */
export async function tick(deps: TickDependencies): Promise<TickResult> {
  // The same kind of context a request gets (logging plan, L5): every line this tick writes carries
  // its id, and the Supabase calls and push sends are timed into its spans for the `tick` line.
  const context: RequestContext = {
    requestId: `tick-${createRequestId()}`,
    method: "TICK",
    route: "worker.tick",
    startedAt: performance.now(),
    spans: [],
    fields: {},
  };
  return runWithRequestContext(context, () => runTick(deps, context));
}

async function runTick(deps: TickDependencies, context: RequestContext): Promise<TickResult> {
  const { store, push, clock, log, version } = deps;
  const startedAt = clock.now();
  try {
    await store.writeHeartbeat({ name: WORKER_NAME, beatAt: startedAt, version });

    // The clean-up needs no push, so it runs whether or not the VAPID keys are set: expired
    // statement-import drafts must go either way (B2).
    const cleaned = await cleanUpNotifications(deps);
    const importsPurged = await purgeImportDrafts(deps);

    if (!push) {
      const due = await store.countDue(startedAt);
      log.error("push_not_configured", {
        error: "Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT to send notifications; outbox rows stay pending.",
        dueNotifications: due.notifications,
        dueReminders: due.reminders,
      });
      return { pushConfigured: false, due, cleaned, importsPurged };
    }

    const todosDue = await queueDueTodos(deps);
    const reminders = await queueDueReminders(deps);
    const events = await queueDueEvents(deps);
    const delivery = await deliverDue({ ...deps, push });
    const ms = clock.now().getTime() - startedAt.getTime();
    const slow = ms > SLOW_TICK_MS;
    log[slow ? "warn" : "info"]("tick", {
      ...delivery,
      remindersClaimed: reminders.claimed,
      remindersQueued: reminders.queued,
      remindersDuplicate: reminders.duplicates,
      remindersChanged: reminders.changed,
      eventsClaimed: events.claimed,
      eventsQueued: events.queued,
      eventsDuplicate: events.duplicates,
      eventsChanged: events.changed,
      ms,
      slow: slow || undefined,
      spans: context.spans,
      ...spanSummary(context, slow),
    });
    return { pushConfigured: true, reminders, events, delivery, cleaned, importsPurged, todosDue };
  } catch (error) {
    log.error("tick_failed", { error: errorMessage(error), ms: clock.now().getTime() - startedAt.getTime() });
    return null;
  }
}
