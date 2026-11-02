import { envLogLevel } from "./level";
import { redactString } from "./redact";
import type { LogFields, LogLevel, LogValue } from "./types";

/** How many errors deep `cause` is followed (the error, its cause, that cause's cause). */
const MAX_CAUSE_DEPTH = 2;
/** The most errors of an `AggregateError` written. */
const MAX_AGGREGATED = 5;
/** The most stack frames written, at debug level only. */
const MAX_FRAMES = 10;
const MAX_NON_ERROR_LENGTH = 200;

const CODE = /^[A-Za-z0-9_]{1,40}$/;

function isErrorLike(value: unknown): value is Record<string, unknown> {
  return value instanceof Error || (typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string");
}

/** A property that may throw when read, as `undefined`. */
function prop(source: Record<string, unknown>, key: string): unknown {
  try {
    return source[key];
  } catch {
    return undefined;
  }
}

function appRoot(): string | null {
  try {
    return typeof process === "undefined" ? null : process.cwd();
  } catch {
    return null;
  }
}

/** The first frames of a stack, with the app's own paths made relative to its root. */
function stackFrames(stack: string): string[] {
  const root = appRoot();
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, MAX_FRAMES)
    .map((frame) => redactString(root ? frame.replaceAll(`file://${root}/`, "").replaceAll(`${root}/`, "") : frame));
}

function nonError(value: unknown): { [key: string]: LogValue } {
  let text: string;
  try {
    text = String(value).slice(0, MAX_NON_ERROR_LENGTH);
  } catch {
    text = "[unprintable]";
  }
  return { name: "NonError", message: redactString(text) };
}

function describe(error: unknown, depth: number, withStack: boolean): { [key: string]: LogValue } {
  if (!isErrorLike(error)) return nonError(error);

  const name = prop(error, "name");
  const message = prop(error, "message");
  const described: { [key: string]: LogValue } = {
    name: typeof name === "string" && name ? redactString(name) : "Error",
    message: redactString(typeof message === "string" ? message : ""),
  };

  const code = prop(error, "code");
  if (typeof code === "number" && Number.isInteger(code)) described.code = code;
  else if (typeof code === "string" && CODE.test(code)) described.code = code;

  const status = prop(error, "status") ?? prop(error, "statusCode");
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) described.status = status;

  // A PostgrestError's `hint` is advice about the query; its `details` can hold row values, so it is never read.
  const hint = prop(error, "hint");
  if (typeof hint === "string" && hint) described.hint = redactString(hint);

  const stack = prop(error, "stack");
  if (withStack && typeof stack === "string") described.stack = stackFrames(stack);

  if (depth < MAX_CAUSE_DEPTH) {
    const cause = prop(error, "cause");
    if (cause !== undefined && cause !== null) described.cause = describe(cause, depth + 1, false);
    const errors = prop(error, "errors");
    if (Array.isArray(errors)) {
      described.errors = errors.slice(0, MAX_AGGREGATED).map((inner) => describe(inner, depth + 1, false));
    }
  }
  return described;
}

/**
 * The fields to log for a caught value: `{ error: { name, message, code?, status?, hint?, stack?,
 * cause?, errors? } }`. Spread it into a line: `log.error("x_failed", { ...errorFields(error), id })`.
 *
 * `message` and `hint` are redacted and clipped like any string. `stack` is the first ten frames
 * with paths relative to the app root, and only at debug level (`options.level`, by default the
 * `LOG_LEVEL` now). A Supabase `PostgrestError` keeps `code`, `message` and `hint` and never
 * `details`, which can hold row values. `cause` is followed two levels deep and an
 * `AggregateError`'s `errors` are written; a thrown value that isn't an error becomes
 * `{ name: "NonError", message }`. Never throws.
 */
export function errorFields(error: unknown, options: { level?: LogLevel } = {}): LogFields {
  try {
    const level = options.level ?? envLogLevel();
    return { error: describe(error, 0, level === "debug") };
  } catch {
    return { error: { name: "NonError", message: "[unserializable]" } };
  }
}
