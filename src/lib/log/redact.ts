import type { LogFields, LogValue } from "./types";

/**
 * Making fields safe to write (logging plan, L1). Redaction is by field name and by value pattern,
 * so a secret in an unexpected field is still caught; every string is clipped and every structure
 * is bounded.
 *
 * SECURITY: this is the last line between a careless `log.info("x", { ...thing })` and the logs.
 * A new rule goes here, with a test; never loosen one to make a field show up, rename the field.
 */

export const REDACTED = "[redacted]";
export const TRUNCATED = "[truncated]";
export const UNSERIALIZABLE = "[unserializable]";

/** The longest string written, ellipsis included. */
export const MAX_STRING_LENGTH = 500;
/** How deep nested objects and arrays go below the fields themselves. */
export const MAX_DEPTH = 4;
/** The most items of an array and keys of an object written. */
export const MAX_ITEMS = 50;
/** Strings are cut to this before the patterns run, so a huge string costs no more than a long one. */
const SCAN_LENGTH = 4_000;

/** Field names (lowercase, without `_` and `-`) that are redacted when they match exactly: too short or common to match as a substring. */
const EXACT_SECRET_NAMES: ReadonlySet<string> = new Set([
  "email",
  "emails",
  "code",
  "body",
  "payload",
  "prompt",
  "answer",
  "rows",
]);
/** Redacted when the name contains one of these (`newPassword`, `clientSecret`, `sessionCookie`). */
const SECRET_SUBSTRINGS: readonly string[] = ["password", "passcode", "secret", "cookie", "authorization", "apikey"];
/** Redacted when the name ends with this (`idToken`, `refresh_token`), but not `inputTokens` or `tokenCount`. */
const SECRET_SUFFIX = "token";

/** What a `code` may look like and still be kept: error codes such as `unrecognised_layout` or `23505`. */
const LOWERCASE_CODE = /^[a-z0-9_]{1,40}$/;
/** System error codes such as `ECONNRESET` and `PGRST116`. */
const UPPERCASE_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
/** The shape of an invite code (see `INVITE_CODE_ALPHABET`), which is never kept. */
const INVITE_CODE = /^[A-HJKMNP-Z2-9]{8}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A full git commit hash, which the worker writes as its `version`. */
const COMMIT = /^[0-9a-f]{40}$/;

/** Value patterns, replaced in place with the rest of the string kept. The long-run rule is applied after them. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sb_(?:secret|publishable)_[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
];
const LONG_RUN = /[A-Za-z0-9_-]{32,}/g;

/** The field name as compared with {@link SECRET_NAMES}: case, `_` and `-` don't matter. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Whether a field of this name is redacted whatever it holds (a `code` may be kept; see
 * {@link redactedValue}). Case, `_` and `-` don't matter, and three rules apply:
 * - the name contains `password`, `passcode`, `secret`, `cookie`, `authorization` or `apikey`;
 * - the name ends with `token` (so `idToken` and `mcpToken`, but not the counts `inputTokens` and
 *   `tokenCount`, nor `tokenId`);
 * - the name is exactly `email`, `emails`, `code`, `body`, `payload`, `prompt`, `answer` or `rows`
 *   (a substring there would catch `emailVerified`, `errorCode` and `rowCount`).
 */
export function isSecretName(name: string): boolean {
  const normalised = normaliseName(name);
  return (
    EXACT_SECRET_NAMES.has(normalised) ||
    normalised.endsWith(SECRET_SUFFIX) ||
    SECRET_SUBSTRINGS.some((part) => normalised.includes(part))
  );
}

/**
 * Redacts the secrets in a string and clips it to {@link MAX_STRING_LENGTH}. Anything shaped like a
 * Supabase key, a `Bearer` credential, a JWT, an email address or a run of 32 or more base64url
 * characters is replaced by `[redacted]`; UUIDs and commit hashes are ids, not secrets, and stay.
 */
export function redactString(text: string): string {
  let result = text.length > SCAN_LENGTH ? text.slice(0, SCAN_LENGTH) : text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, REDACTED);
  result = result.replace(LONG_RUN, (run) => (UUID.test(run) || COMMIT.test(run) ? run : REDACTED));
  return result.length > MAX_STRING_LENGTH ? `${result.slice(0, MAX_STRING_LENGTH - 1)}…` : result;
}

/** A named field's value: `[redacted]`, except a `code` that is an error code. */
function redactedValue(name: string, value: unknown): LogValue {
  if (normaliseName(name) !== "code") return REDACTED;
  if (typeof value === "number") return Number.isInteger(value) ? value : REDACTED;
  if (typeof value !== "string") return REDACTED;
  const isErrorCode = LOWERCASE_CODE.test(value) || (UPPERCASE_CODE.test(value) && !INVITE_CODE.test(value));
  return isErrorCode ? redactString(value) : REDACTED;
}

/** Reads a property that may throw (a getter, a revoked proxy) as a value the logger can write. */
function read(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return UNSERIALIZABLE;
  }
}

function sanitizeObject(source: object, depth: number, seen: Set<object>): LogValue {
  if (depth > MAX_DEPTH) return TRUNCATED;
  const result: Record<string, LogValue> = Object.create(null);
  const keys = Object.keys(source);
  let kept = 0;
  for (const key of keys) {
    const raw = read(source, key);
    if (raw === undefined) continue;
    if (kept >= MAX_ITEMS) {
      result._truncated = keys.length - kept;
      break;
    }
    result[redactString(key)] = isSecretName(key) ? redactedValue(key, raw) : sanitizeValue(raw, depth + 1, seen);
    kept += 1;
  }
  return result;
}

function sanitizeArray(source: unknown[], depth: number, seen: Set<object>): LogValue {
  if (depth > MAX_DEPTH) return TRUNCATED;
  const items = source.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen));
  if (source.length > MAX_ITEMS) items.push(TRUNCATED);
  return items;
}

/**
 * Makes one value writable: strings redacted and clipped, structures bounded, and whatever JSON
 * can't hold (a `BigInt`, a function, a cycle) written as `[unserializable]`. `depth` counts the
 * objects and arrays above this value. Never throws.
 */
export function sanitizeValue(value: unknown, depth = 0, seen: Set<object> = new Set()): LogValue {
  try {
    switch (typeof value) {
      case "string":
        return redactString(value);
      case "number":
        return Number.isFinite(value) ? value : null;
      case "boolean":
        return value;
      case "undefined":
        return null;
      case "object":
        break;
      default:
        return UNSERIALIZABLE;
    }
    if (value === null) return null;
    if (seen.has(value)) return UNSERIALIZABLE;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    seen.add(value);
    try {
      if (value instanceof Error) {
        return sanitizeObject({ name: value.name, message: value.message }, depth, seen);
      }
      return Array.isArray(value) ? sanitizeArray(value, depth, seen) : sanitizeObject(value, depth, seen);
    } finally {
      seen.delete(value);
    }
  } catch {
    return UNSERIALIZABLE;
  }
}

/** The fields of a line, made writable by {@link sanitizeValue} under the field rules (names, values, limits). */
export function sanitizeFields(fields: LogFields): Record<string, LogValue> {
  const result = sanitizeValue(fields);
  return result !== null && typeof result === "object" && !Array.isArray(result) ? result : {};
}
