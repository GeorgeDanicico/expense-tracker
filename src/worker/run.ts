import { errorMessage, type WorkerLog } from "@/lib/notifications/worker";

/** The signals that stop the worker: `docker stop` sends SIGTERM, Ctrl+C SIGINT. */
export const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;

type StopSignal = (typeof STOP_SIGNALS)[number];

/** The parts of `process` the runner uses, so a test can pass an `EventEmitter`. */
export type WorkerProcess = {
  on(signal: StopSignal, listener: () => void): unknown;
  exit(code: number): void;
};

export type RunWorkerOptions = {
  /** One tick; it should not throw, but a rejection is logged and the loop goes on. */
  tick: () => Promise<unknown>;
  intervalMs: number;
  log: WorkerLog;
  process: WorkerProcess;
  now?: () => number;
};

/**
 * Runs `tick` now and then every `intervalMs` (measured from the start of each tick, so a slow tick
 * doesn't push the schedule back further), until SIGTERM or SIGINT. On the first signal it lets the
 * running tick finish, skips the wait and exits with 0. A second signal exits at once with 1.
 *
 * Returns a promise that settles when the loop has stopped (before `exit` is called).
 */
export function runWorker({ tick, intervalMs, log, process, now = Date.now }: RunWorkerOptions) {
  let stopping = false;
  let wake: (() => void) | null = null;

  const stopped = (async () => {
    while (!stopping) {
      const startedAt = now();
      try {
        await tick();
      } catch (error) {
        log.error("tick_failed", { error: errorMessage(error) });
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, intervalMs - (now() - startedAt)));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  })();

  const stop = (signal: StopSignal) => {
    if (stopping) {
      log.error("forced_exit", { signal });
      process.exit(1);
      return;
    }
    stopping = true;
    log.info("stopping", { signal });
    wake?.();
    void stopped.then(() => {
      log.info("stopped");
      process.exit(0);
    });
  };

  for (const signal of STOP_SIGNALS) process.on(signal, () => stop(signal));
  return stopped;
}
