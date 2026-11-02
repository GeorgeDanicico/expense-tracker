import "server-only";

/**
 * Counts failed attempts per key (such as a user id) and says when a key has too many. In memory:
 * the app runs as a single process, so a restart forgetting the counts is acceptable. Every limit in
 * the app, the MCP token throttle included, is one of these (a request limit is one too, through
 * `createRequestLimiter`).
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

/**
 * Counts every request per key (a user id or a client IP) and refuses the ones past a limit. Built on
 * the failure counter, so it has the same sliding window, the same bounded memory and the same
 * reset for tests.
 */
export type RequestLimiter = {
  /**
   * Counts a request by `key`. Returns 0 when it may go on, or the whole seconds (at least 1) until
   * `key` may send another. A refused request isn't counted, so a client that keeps trying is let
   * through again as soon as its oldest counted request leaves the window.
   */
  take(key: string): number;
};

/** A limiter that lets a key send `maxRequests` requests in any `windowMs` (a sliding window, not a fixed minute). */
export function createRequestLimiter({
  maxRequests,
  windowMs,
  maxKeys,
}: {
  maxRequests: number;
  windowMs: number;
  maxKeys?: number;
}): RequestLimiter {
  const requests = createFailureLimiter({ maxFailures: maxRequests, windowMs, maxKeys });
  return {
    take(key) {
      if (requests.isLimited(key)) return requests.retryAfterSeconds(key);
      requests.recordAttempt(key);
      return 0;
    },
  };
}

const MINUTE_MS = 60 * 1000;

/**
 * Request limits (security plan S11, audit P8). Every route is behind one of them, set by the route
 * wrappers in `src/lib/http/route.ts` and the MCP route, never by a route by hand. They are generous
 * on purpose: one page load makes under ten requests, so normal use is nowhere near them. They stop
 * a script or a runaway client, and are to be tightened once real usage shows in the logs
 * (phase 15). All of them are per minute, in a sliding window, and a limited request gets 429 with
 * `Retry-After` and `{ error }`. (The sign-in, upload and token limits above, and the CSP report
 * limit below, are separate and stay.)
 *
 * | Who                                                   | Limit      | Key              | Where                  |
 * | ----------------------------------------------------- | ---------- | ---------------- | ---------------------- |
 * | Signed in, `GET`/`HEAD`/`OPTIONS`                     | 600 a min  | user id          | `withUser` (and so `withPermission`, `withParent`) |
 * | Signed in, any other method                           | 120 a min  | user id          | `withUser`             |
 * | A signed-in route with no valid session (401)         | 120 a min  | client IP        | `withUser`             |
 * | Anonymous: sign-in and sign-up, calendar feed, OAuth and email-link redirects, OAuth metadata | 60 a min | client IP | `withRequestGuard`, `withAnonymousLimit` |
 * | MCP, before the token is read                         | 600 a min  | client IP        | `/api/mcp`             |
 * | MCP, a signed-in user                                 | 300 a min  | user id          | `/api/mcp`             |
 * | CSP reports                                           | 60 a min   | client IP        | `/api/csp-report`      |
 *
 * Not limited: `/health` (the deploy's check, no data) and the worker, which talks to the database
 * and never to the app's routes.
 */
export const USER_READ_MAX_REQUESTS = 600;
export const USER_WRITE_MAX_REQUESTS = 120;
export const SIGNED_OUT_MAX_REQUESTS = 120;
export const ANONYMOUS_MAX_REQUESTS = 60;
export const MCP_IP_MAX_REQUESTS = 600;
export const MCP_USER_MAX_REQUESTS = 300;
export const REQUEST_WINDOW_MS = MINUTE_MS;

/** Reads (`GET`, `HEAD`, `OPTIONS`) per signed-in user id. */
export const userReadRequests = createRequestLimiter({ maxRequests: USER_READ_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });
/** Writes (every other method) per signed-in user id. */
export const userWriteRequests = createRequestLimiter({ maxRequests: USER_WRITE_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });
/** Requests to a signed-in route that carry no valid session, per client IP: each one costs a session check. */
export const signedOutRequests = createRequestLimiter({ maxRequests: SIGNED_OUT_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });
/** Requests to the routes that need no session, per client IP. */
export const anonymousRequests = createRequestLimiter({ maxRequests: ANONYMOUS_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });
/** Requests to `/api/mcp` per client IP, counted before the token is checked. */
export const mcpIpRequests = createRequestLimiter({ maxRequests: MCP_IP_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });
/** Requests to `/api/mcp` per authenticated user id. */
export const mcpUserRequests = createRequestLimiter({ maxRequests: MCP_USER_MAX_REQUESTS, windowMs: REQUEST_WINDOW_MS });

/** What a route answers, with status 429, to a client over a request limit. */
export const TOO_MANY_REQUESTS = "You're sending requests too fast. Wait a moment and try again.";

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

/** Account deletions allowed per user in `ACCOUNT_DELETION_WINDOW_MS`, counting every attempt. */
export const ACCOUNT_DELETION_MAX_ATTEMPTS = 5;
export const ACCOUNT_DELETION_WINDOW_MS = 60 * 60 * 1000;

/**
 * `DELETE /api/account` and `DELETE /api/family/members/[id]/account` per user id (the caller: the
 * account's owner, or the parent deleting a kid's account), together. Records every attempt (through
 * `recordAttempt`): each one checks a password, so this also caps password guessing from a stolen
 * session.
 */
export const accountDeletionAttempts = createFailureLimiter({
  maxFailures: ACCOUNT_DELETION_MAX_ATTEMPTS,
  windowMs: ACCOUNT_DELETION_WINDOW_MS,
});

/** What the deletion routes answer, with status 429, past `ACCOUNT_DELETION_MAX_ATTEMPTS`. */
export const TOO_MANY_ACCOUNT_DELETIONS = "You've tried to delete an account a lot recently. Try again in an hour.";

/** Data exports allowed per user in `DATA_EXPORT_WINDOW_MS`, counting every attempt. */
export const DATA_EXPORT_MAX_ATTEMPTS = 5;
export const DATA_EXPORT_WINDOW_MS = 60 * 60 * 1000;

/**
 * `POST /api/account/export` per user id. Records every attempt (through `recordAttempt`): each one
 * reads every table the user has rows in, far more than any other request.
 */
export const dataExportAttempts = createFailureLimiter({
  maxFailures: DATA_EXPORT_MAX_ATTEMPTS,
  windowMs: DATA_EXPORT_WINDOW_MS,
});

/** What the export answers, with status 429, past `DATA_EXPORT_MAX_ATTEMPTS`. */
export const TOO_MANY_DATA_EXPORTS = "You've downloaded your data a lot recently. Try again in an hour.";

/** CSP violation report requests allowed per client IP in `CSP_REPORT_WINDOW_MS`, counting every one. */
export const CSP_REPORT_MAX_ATTEMPTS = 60;
export const CSP_REPORT_WINDOW_MS = 60 * 1000;

/**
 * `POST /api/csp-report` per client IP (`clientIp`). Records every request (through
 * `recordAttempt`): anyone can send one, and each is a log line. One page load breaking the policy
 * sends one report per violation, so the limit leaves room for a badly broken page.
 */
export const cspReportAttempts = createFailureLimiter({
  maxFailures: CSP_REPORT_MAX_ATTEMPTS,
  windowMs: CSP_REPORT_WINDOW_MS,
});

/** What the report endpoint answers, with status 429, past `CSP_REPORT_MAX_ATTEMPTS`. */
export const TOO_MANY_CSP_REPORTS = "Too many reports. Try again in a minute.";

/** What a route answers, with status 429, to a key over its limit. */
export const TOO_MANY_ATTEMPTS_MESSAGE = "Too many codes that didn't work. Try again in a few minutes.";

/**
 * For tests only: forgets every failure of every limiter, so each test starts with clean counts.
 * Call it in `beforeEach` of a test that goes through a rate-limited route.
 */
export function resetRateLimits(): void {
  for (const failures of allFailures) failures.clear();
}
