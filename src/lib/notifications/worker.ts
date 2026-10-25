import type { DueCounts, WorkerStore } from "@/lib/notifications/worker-store";

/** The heartbeat name of the notifications worker. */
export const WORKER_NAME = "worker";

/** How long the worker waits between the starts of two ticks. */
export const TICK_INTERVAL_MS = 30_000;

export type Clock = { now(): Date };

/** Structured log fields: one flat object per line. */
export type LogFields = Record<string, string | number | boolean | null>;

export interface WorkerLog {
  info(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type TickDependencies = {
  store: WorkerStore;
  clock: Clock;
  log: WorkerLog;
  /** The build the worker runs (a git SHA or the package version), written with the heartbeat. */
  version: string;
};

/** What a tick saw, or null when it failed (the failure is logged). */
export type TickResult = { due: DueCounts } | null;

/** An error's message, without its stack or any attached request details. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One pass of the worker. For now it writes the heartbeat and logs how many outbox rows and
 * reminders are due; claiming and sending come with Web Push (R7) and reminder notifications (R8).
 * It never throws: a failure is logged as one `tick_failed` line and the next tick tries again.
 */
export async function tick({ store, clock, log, version }: TickDependencies): Promise<TickResult> {
  const startedAt = clock.now();
  try {
    await store.writeHeartbeat({ name: WORKER_NAME, beatAt: startedAt, version });
    const due = await store.countDue(startedAt);
    log.info("tick", {
      dueNotifications: due.notifications,
      dueReminders: due.reminders,
      ms: clock.now().getTime() - startedAt.getTime(),
    });
    return { due };
  } catch (error) {
    log.error("tick_failed", { error: errorMessage(error), ms: clock.now().getTime() - startedAt.getTime() });
    return null;
  }
}
