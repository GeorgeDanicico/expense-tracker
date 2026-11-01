import "server-only";

/**
 * Counts failed attempts per key (such as a user id) and says when a key has too many. In memory:
 * the app runs as a single process, so a restart forgetting the counts is acceptable. Every limit in
 * the app, the MCP token throttle included, is one of these.
 */
export type FailureLimiter = {
  /** Whether `key` already has the maximum failures inside the window, so its next attempt must be refused. */
  isLimited(key: string): boolean;
  /** Whole seconds until `key` may try again (at least 1 while it is limited), or 0 when it isn't limited. */
  retryAfterSeconds(key: string): number;
  /** Records a failed attempt by `key`. Successes are never recorded, and don't clear earlier failures. */
  recordFailure(key: string): void;
  /**
   * The same as `recordFailure`, named for limiters that count every attempt, failed or not (such as
   * uploads), so the call says what it counts.
   */
  recordAttempt(key: string): void;
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

  function recordFailure(key: string) {
    const now = Date.now();
    const recent = recentFailures(key, now);
    failures.delete(key);
    if (failures.size >= maxKeys) makeRoom(now);
    // Only the newest `maxFailures` times can matter, so a key's list never grows past that.
    failures.set(key, [...recent, now].slice(-maxFailures));
  }

  return {
    isLimited(key) {
      return recentFailures(key, Date.now()).length >= maxFailures;
    },

    retryAfterSeconds(key) {
      const now = Date.now();
      const recent = recentFailures(key, now);
      if (recent.length < maxFailures) return 0;
      // The key is let through again once its oldest counted failure leaves the window.
      const oldest = recent[recent.length - maxFailures];
      return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    },

    recordFailure,
    recordAttempt: recordFailure,
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

// This limiter shares the in-memory store under review in #93
// (https://github.com/GeorgeDanicico/expense-tracker/issues/93); its follow-up moves this one too.

/** Avatar uploads allowed per user in `AVATAR_UPLOAD_WINDOW_MS`, counting every attempt. */
export const AVATAR_UPLOAD_MAX_ATTEMPTS = 20;
export const AVATAR_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/**
 * Avatar uploads per user id for `PUT /api/account/avatar`. Unlike the invite limiter it records
 * every attempt (through `recordAttempt`), because each one costs an image decode.
 */
export const avatarUploadAttempts = createFailureLimiter({
  maxFailures: AVATAR_UPLOAD_MAX_ATTEMPTS,
  windowMs: AVATAR_UPLOAD_WINDOW_MS,
});

/** Statement uploads allowed per user in `IMPORT_UPLOAD_WINDOW_MS`, counting every attempt. */
export const IMPORT_UPLOAD_MAX_ATTEMPTS = 30;
export const IMPORT_UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/**
 * Statement uploads per user id for `POST /api/imports`. Like the avatar limiter it records every
 * attempt (through `recordAttempt`), because each one costs a parse.
 */
export const importUploadAttempts = createFailureLimiter({
  maxFailures: IMPORT_UPLOAD_MAX_ATTEMPTS,
  windowMs: IMPORT_UPLOAD_WINDOW_MS,
});

/** What the import upload answers, with status 429, past `IMPORT_UPLOAD_MAX_ATTEMPTS`. */
export const TOO_MANY_IMPORT_UPLOADS = "You've uploaded a lot of statements recently. Try again in an hour.";

/** Personal token changes allowed per user in `MCP_TOKEN_CHANGE_WINDOW_MS`, counting every attempt. */
export const MCP_TOKEN_CHANGE_MAX_ATTEMPTS = 30;
export const MCP_TOKEN_CHANGE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Creating, regenerating and revoking personal MCP tokens, per user id, across
 * `POST /api/account/mcp/tokens`, `POST /api/account/mcp/tokens/[id]/regenerate` and
 * `DELETE /api/account/mcp/tokens/[id]` together. Like the avatar limiter, it records every attempt
 * (through `recordAttempt`).
 */
export const mcpTokenChangeAttempts = createFailureLimiter({
  maxFailures: MCP_TOKEN_CHANGE_MAX_ATTEMPTS,
  windowMs: MCP_TOKEN_CHANGE_WINDOW_MS,
});

/** What the token routes answer, with status 429, past `MCP_TOKEN_CHANGE_MAX_ATTEMPTS`. */
export const TOO_MANY_MCP_TOKEN_CHANGES = "You've changed your tokens a lot recently. Try again in an hour.";

/** Wrong passwords allowed per sign-in name (an email or a username) in `SIGN_IN_WINDOW_MS`. */
export const SIGN_IN_NAME_MAX_FAILURES = 5;
/** Wrong passwords allowed per client IP in `SIGN_IN_WINDOW_MS`, across every sign-in name. */
export const SIGN_IN_IP_MAX_FAILURES = 20;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Failed sign-ins (`POST /api/auth`, `mode: "login"`) per normalised sign-in name. Checked before the
 * auth provider is asked; only a wrong password or an unknown name is recorded, never a success.
 * Keyed by name as well as by IP, so changing the (spoofable) IP alone doesn't reset it.
 */
export const signInNameFailures = createFailureLimiter({
  maxFailures: SIGN_IN_NAME_MAX_FAILURES,
  windowMs: SIGN_IN_WINDOW_MS,
});

/** Failed sign-ins per client IP (`clientIp`), recorded alongside `signInNameFailures`. */
export const signInIpFailures = createFailureLimiter({
  maxFailures: SIGN_IN_IP_MAX_FAILURES,
  windowMs: SIGN_IN_WINDOW_MS,
});

/** What sign-in answers, with status 429, to a name or IP over its limit. */
export const TOO_MANY_SIGN_INS = "Too many sign-in attempts. Try again in a few minutes.";

/** Sign-ups allowed per client IP in `SIGN_UP_WINDOW_MS`, counting every attempt. */
export const SIGN_UP_MAX_ATTEMPTS = 10;
export const SIGN_UP_WINDOW_MS = 60 * 60 * 1000;

/**
 * Sign-ups (`POST /api/auth`, `mode: "signup"`) per client IP. Records every attempt (through
 * `recordAttempt`), because each one can make the auth provider send an email.
 */
export const signUpAttempts = createFailureLimiter({
  maxFailures: SIGN_UP_MAX_ATTEMPTS,
  windowMs: SIGN_UP_WINDOW_MS,
});

/** What sign-up answers, with status 429, past `SIGN_UP_MAX_ATTEMPTS`. */
export const TOO_MANY_SIGN_UPS = "Too many sign-ups from this network. Try again in an hour.";

/** Password changes allowed per user in `PASSWORD_CHANGE_WINDOW_MS`, counting every attempt. */
export const PASSWORD_CHANGE_MAX_ATTEMPTS = 10;
export const PASSWORD_CHANGE_WINDOW_MS = 60 * 60 * 1000;

/** `POST /api/account/password` per user id. Records every attempt (through `recordAttempt`). */
export const passwordChangeAttempts = createFailureLimiter({
  maxFailures: PASSWORD_CHANGE_MAX_ATTEMPTS,
  windowMs: PASSWORD_CHANGE_WINDOW_MS,
});

/** What the password change answers, with status 429, past `PASSWORD_CHANGE_MAX_ATTEMPTS`. */
export const TOO_MANY_PASSWORD_CHANGES = "You've tried to change your password a lot recently. Try again in an hour.";

/** Email changes allowed per user in `EMAIL_CHANGE_WINDOW_MS`, counting every attempt. */
export const EMAIL_CHANGE_MAX_ATTEMPTS = 5;
export const EMAIL_CHANGE_WINDOW_MS = 60 * 60 * 1000;

/**
 * `PATCH /api/account/email` per user id. Records every attempt (through `recordAttempt`), because
 * each accepted one sends a confirmation email.
 */
export const emailChangeAttempts = createFailureLimiter({
  maxFailures: EMAIL_CHANGE_MAX_ATTEMPTS,
  windowMs: EMAIL_CHANGE_WINDOW_MS,
});

/** What the email change answers, with status 429, past `EMAIL_CHANGE_MAX_ATTEMPTS`. */
export const TOO_MANY_EMAIL_CHANGES = "You've tried to change your email a lot recently. Try again in an hour.";

/** What a route answers, with status 429, to a key over its limit. */
export const TOO_MANY_ATTEMPTS_MESSAGE = "Too many codes that didn't work. Try again in a few minutes.";

/**
 * For tests only: forgets every failure of every limiter, so each test starts with clean counts.
 * Call it in `beforeEach` of a test that goes through a rate-limited route.
 */
export function resetRateLimits(): void {
  for (const failures of allFailures) failures.clear();
}
