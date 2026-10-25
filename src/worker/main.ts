/**
 * The notifications worker: `node worker.js` in the same image as the web app (see the Dockerfile).
 * Bundled by `npm run build:worker`; it must not import `next/*` or anything that needs a request.
 *
 * Env: SUPABASE_URL and SUPABASE_SECRET_KEY (the worker acts for every user), and optionally
 * GIT_SHA, the build written with the heartbeat (the package version otherwise).
 */
import { version as packageVersion } from "../../package.json";

import { TICK_INTERVAL_MS, errorMessage, tick } from "@/lib/notifications/worker";
import { createSupabaseWorkerStore } from "@/lib/supabase/worker-store";
import { createJsonLog } from "@/worker/log";
import { runWorker } from "@/worker/run";

const log = createJsonLog();
const version = process.env.GIT_SHA?.trim() || packageVersion;

/** The store, or exit with 1 when the env lacks the URL or the secret key. */
function createStore() {
  try {
    return createSupabaseWorkerStore();
  } catch (error) {
    log.error("start_failed", { error: errorMessage(error) });
    process.exit(1);
  }
}

const store = createStore();

log.info("started", { version, intervalMs: TICK_INTERVAL_MS });
const clock = { now: () => new Date() };
void runWorker({
  tick: () => tick({ store, clock, log, version }),
  intervalMs: TICK_INTERVAL_MS,
  log,
  process,
});
