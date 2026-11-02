import { envLogLevel, LOG_LEVELS } from "./level";
import { redactString, sanitizeFields } from "./redact";
import type { LogFields, Logger, LogLevel, Write } from "./types";

/**
 * The shared logger (logging plan, L1): the web app, the worker and, as types only, client code.
 * One JSON object per line, `{ time, level, event, ...fields }`; `debug` and `info` go to stdout and
 * `warn` and `error` to stderr, which `docker logs` shows together.
 *
 * Fields are redacted by name and by value and bounded before they're written (see `redact.ts`),
 * and logging never throws: a field that can't be written becomes `[unserializable]` and a failing
 * write is dropped.
 *
 * It imports nothing from `next/*` or `server-only`, so the worker bundle and client code can use it.
 */

export { DEFAULT_LOG_LEVEL, parseLogLevel } from "./level";
export { errorFields } from "./serialize";
export type { LogFields, Logger, LogLevel, LogValue, Write } from "./types";

const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Whether `event` is a `snake_case` event name of at most 64 characters. */
export function isEventName(event: string): boolean {
  return EVENT_NAME.test(event);
}

export type LoggerOptions = {
  /** Where `debug` and `info` lines go; default stdout. */
  out?: Write;
  /** Where `warn` and `error` lines go; default stderr. */
  err?: Write;
  now?: () => Date;
  /** The lowest level written; default `LOG_LEVEL`, else `info`. */
  level?: LogLevel;
  /** Fields on every line. */
  base?: LogFields;
  /** Fields added to every line when it is written, such as the request id; default the one set by {@link setLogContext}. */
  context?: () => LogFields | undefined;
};

let defaultContext: (() => LogFields | undefined) | undefined;

/**
 * Sets where loggers without their own `context` option get the fields of the current request or
 * tick (`requestId`), called once per line written. `undefined` clears it. L2 sets it from its
 * request store.
 */
export function setLogContext(provider: (() => LogFields | undefined) | undefined): void {
  defaultContext = provider;
}

/** The keys a line starts with, which no field can replace. */
const RESERVED = ["time", "level", "event"];

function formatLine(
  level: LogLevel,
  event: string,
  now: () => Date,
  layers: readonly (LogFields | undefined)[],
): string {
  const merged: LogFields = {};
  for (const layer of layers) Object.assign(merged, layer);
  for (const key of RESERVED) delete merged[key];
  const name = isEventName(event) ? event : `invalid_event:${redactString(String(event)).slice(0, 100)}`;
  return `${JSON.stringify({ time: now().toISOString(), level, event: name, ...sanitizeFields(merged) })}\n`;
}

/**
 * A logger. Lines below `level` cost one comparison. `time`, `level` and `event` always come first;
 * then `base`, the context's fields and the line's own, later ones replacing earlier ones. An
 * event name that isn't `snake_case` is written as `invalid_event:<name>` so it's noticed.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const out = options.out ?? ((line) => void process.stdout.write(line));
  const err = options.err ?? ((line) => void process.stderr.write(line));
  const now = options.now ?? (() => new Date());
  const threshold = LOG_LEVELS[options.level ?? envLogLevel()];
  const context = () => (options.context ?? defaultContext)?.();

  const build = (base: LogFields | undefined): Logger => {
    const writer = (level: LogLevel) => (event: string, fields?: LogFields) => {
      if (LOG_LEVELS[level] < threshold) return;
      try {
        const write = LOG_LEVELS[level] >= LOG_LEVELS.warn ? err : out;
        write(formatLine(level, event, now, [base, context(), fields]));
      } catch {
        // Logging must never break the caller; a line that can't be written is dropped.
      }
    };
    return {
      debug: writer("debug"),
      info: writer("info"),
      warn: writer("warn"),
      error: writer("error"),
      child: (fields) => build({ ...base, ...fields }),
    };
  };
  return build(options.base);
}

/** The process-wide logger: the level comes from `LOG_LEVEL` when this module loads. */
export const log: Logger = createLogger();
