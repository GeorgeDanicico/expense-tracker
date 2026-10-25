/**
 * The notifications worker: `node worker.js` in the same image as the web app (see the Dockerfile).
 * Bundled by `npm run build:worker`; it must not import `next/*` or anything that needs a request.
 *
 * Env: SUPABASE_URL and SUPABASE_SECRET_KEY (the worker acts for every user); VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY and VAPID_SUBJECT to sign Web Push (without them it logs `push_not_configured`
 * each tick and leaves the outbox pending rather than exiting, so a missing key never crash-loops
 * the container); and optionally GIT_SHA, the build written with the heartbeat (the package version
 * otherwise).
 */
import { version as packageVersion } from "../../package.json";

import { createWebPushSender, readVapidConfig, type PushSender } from "@/lib/notifications/push";
import { TICK_INTERVAL_MS, createWorkerState, errorMessage, tick } from "@/lib/notifications/worker";
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

/** The Web Push sender, or null (logged, never with a key's value) when the VAPID env is missing or bad. */
function createPush(): PushSender | null {
  const vapid = readVapidConfig(process.env);
  if (!vapid.ok) {
    log.error("push_not_configured", { error: `Missing ${vapid.missing.join(", ")}; notifications stay pending.` });
    return null;
  }
  try {
    return createWebPushSender(vapid.config);
  } catch (error) {
    // web-push's messages never contain a key, but may repeat the subject; keep that out of the log too.
    const message = errorMessage(error).replaceAll(vapid.config.subject, "<VAPID_SUBJECT>");
    log.error("push_not_configured", { error: `Invalid VAPID settings: ${message}; notifications stay pending.` });
    return null;
  }
}

const store = createStore();
const push = createPush();
const state = createWorkerState();

log.info("started", { version, intervalMs: TICK_INTERVAL_MS, push: push !== null });
const clock = { now: () => new Date() };
void runWorker({
  tick: () => tick({ store, push, clock, log, version, state }),
  intervalMs: TICK_INTERVAL_MS,
  log,
  process,
});
