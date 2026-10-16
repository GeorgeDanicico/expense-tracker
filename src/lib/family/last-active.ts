import "server-only";

import { isFamilyEnabled } from "@/lib/features";
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

async function touch() {
  await getRepositories().family.touchLastActive();
}

/**
 * Records that `userId` is active, without delaying the caller: when the family flag is on, starts
 * `touchLastActive()` and returns at once, at most once per user per 5 minutes in this process.
 * Any failure is ignored. No membership lookup first: the SQL already does nothing for a user
 * without a family.
 */
export function touchLastActiveInBackground(userId: string): void {
  if (!isFamilyEnabled()) return;

  const now = Date.now();
  const touchedAt = lastTouched.get(userId);
  if (touchedAt !== undefined && now - touchedAt < TOUCH_INTERVAL_MS) return;

  lastTouched.delete(userId);
  if (lastTouched.size >= MAX_REMEMBERED) makeRoom(now);
  lastTouched.set(userId, now);

  // Last activity is best effort: a failure must never reach the response, and isn't logged.
  touch().catch(() => {});
}

/**
 * For tests only: forgets every touch, so the next request of each user touches again. Call it in
 * `beforeEach` of a test that asserts the family repository's `calls` while the flag is on, so the
 * result doesn't depend on which test ran first.
 */
export function forgetLastActive(): void {
  lastTouched.clear();
}
