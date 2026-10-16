import "server-only";

/**
 * Counts failed attempts per key (such as a user id) and says when a key has too many. In memory:
 * the app runs as a single process, so a restart forgetting the counts is acceptable. The MCP
 * sign-in has its own limiter in `src/lib/mcp/auth.ts`.
 */
export type FailureLimiter = {
  /** Whether `key` already has the maximum failures inside the window, so its next attempt must be refused. */
  isLimited(key: string): boolean;
  /** Records a failed attempt by `key`. Successes are never recorded, and don't clear earlier failures. */
  recordFailure(key: string): void;
};

/** Most keys remembered at once by one limiter; past this, the keys that failed least recently are forgotten first. */
export const MAX_TRACKED_KEYS = 10_000;

/** Every limiter's state, so tests can reset them all. */
const allFailures: Map<string, number[]>[] = [];

/**
 * A limiter that refuses a key once it has `maxFailures` failures in the last `windowMs`. A key's
 * oldest failure stops counting `windowMs` after it happened. At most `maxKeys` keys are remembered:
 * when full, expired keys and then the least recently failed ones are dropped.
 */
export function createFailureLimiter({
  maxFailures,
  windowMs,
  maxKeys = MAX_TRACKED_KEYS,
}: {
  maxFailures: number;
  windowMs: number;
  maxKeys?: number;
}): FailureLimiter {
  /** Each key's failure times inside the window, oldest first; keys are ordered by their latest failure. */
  const failures = new Map<string, number[]>();
  allFailures.push(failures);

  /** The key's failures inside the window, forgetting the key once it has none. */
  function recentFailures(key: string, now: number) {
    const recent = (failures.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length === 0) failures.delete(key);
    return recent;
  }

  /** Drops expired keys from the front, and the least recently failed ones while the map is full. */
  function makeRoom(now: number) {
    for (const [key, times] of failures) {
      if (failures.size < maxKeys && now - times[times.length - 1] < windowMs) break;
      failures.delete(key);
    }
  }

  return {
    isLimited(key) {
      return recentFailures(key, Date.now()).length >= maxFailures;
    },

    recordFailure(key) {
      const now = Date.now();
      const recent = recentFailures(key, now);
      failures.delete(key);
      if (failures.size >= maxKeys) makeRoom(now);
      // Only the newest `maxFailures` times can matter, so a key's list never grows past that.
      failures.set(key, [...recent, now].slice(-maxFailures));
    },
  };
}

/** Failed invite codes allowed per user in `INVITE_CODE_WINDOW_MS`, across preview and join together. */
export const INVITE_CODE_MAX_FAILURES = 10;
export const INVITE_CODE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Invite codes that didn't work, per user id, for `POST /api/family/join/preview` and
 * `POST /api/family/join`. Check it before the database is asked; record only a code that isn't valid.
 */
export const inviteCodeAttempts = createFailureLimiter({
  maxFailures: INVITE_CODE_MAX_FAILURES,
  windowMs: INVITE_CODE_WINDOW_MS,
});

/** What a route answers, with status 429, to a key over its limit. */
export const TOO_MANY_ATTEMPTS_MESSAGE = "Too many codes that didn't work. Try again in a few minutes.";

/**
 * For tests only: forgets every failure of every limiter, so each test starts with clean counts.
 * Call it in `beforeEach` of a test that goes through a rate-limited route.
 */
export function resetRateLimits(): void {
  for (const failures of allFailures) failures.clear();
}
