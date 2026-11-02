import "server-only";

import { after } from "next/server";

import { isFamilyEnabled } from "@/lib/features";
import { errorFields, log } from "@/lib/log";
import { getRepositories } from "@/lib/repositories";

/** How long after a touch the same user isn't touched again. `touch_last_active()` skips the same window. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Most users remembered at once; past this, the oldest entries are forgotten first. */
export const MAX_REMEMBERED = 10_000;

/** When each user was last touched by this process, oldest first (an entry is re-inserted on each touch). */
const lastTouched = new Map<string, number>();

/** Drops expired entries from the front, and the oldest ones while the map is full. */
function makeRoom(now: number) {
  for (const [userId, touchedAt] of lastTouched) {
    if (lastTouched.size < MAX_REMEMBERED && now - touchedAt < TOUCH_INTERVAL_MS) break;
    lastTouched.delete(userId);
  }
}

/** Runs `task` after the response is sent, or at some later point. The task never rejects. */
export type Scheduler = (task: () => Promise<void>) => void;

/**
 * The default scheduler: Next's `after()`, which runs the task once the response is finished and
 * lets it read cookies and headers (route handlers, which `withUser` always is). Outside a request
 * scope, where `after()` throws (a unit test calling the function directly), it starts the task at once.
 */
const afterResponse: Scheduler = (task) => {
  try {
    after(task);
  } catch {
    void task();
  }
};

async function touch(userId: string) {
  try {
    await getRepositories().family.touchLastActive();
  } catch (error) {
    // Best effort, so debug only: it must never reach the response, and a database blip every
    // 5 minutes per user isn't news.
    log.debug("last_active_failed", { userId, ...errorFields(error) });
  }
}

/**
 * Records that `userId` is active, without delaying the caller: when the family flag is on, schedules
 * `touchLastActive()` with `schedule` (by default Next's `after()`, so it runs once the response is
 * sent) and returns at once, at most once per user per 5 minutes in this process. A failure is
 * logged as `last_active_failed` at `debug` and never reaches the response. No membership lookup
 * first: the SQL already does nothing for a user without a family.
 */
export function touchLastActiveInBackground(userId: string, schedule: Scheduler = afterResponse): void {
  if (!isFamilyEnabled()) return;

  const now = Date.now();
  const touchedAt = lastTouched.get(userId);
  if (touchedAt !== undefined && now - touchedAt < TOUCH_INTERVAL_MS) return;

  lastTouched.delete(userId);
  if (lastTouched.size >= MAX_REMEMBERED) makeRoom(now);
  lastTouched.set(userId, now);

  try {
    schedule(() => touch(userId));
  } catch (error) {
    log.debug("last_active_failed", { userId, ...errorFields(error) });
  }
}

/**
 * For tests only: forgets every touch, so the next request of each user touches again. Call it in
 * `beforeEach` of a test that asserts the family repository's `calls` while the flag is on, so the
 * result doesn't depend on which test ran first.
 */
export function forgetLastActive(): void {
  lastTouched.clear();
}
