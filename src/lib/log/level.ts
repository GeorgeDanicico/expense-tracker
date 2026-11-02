import type { LogLevel } from "./types";

/** The levels by rank: a line is written when its rank is at least the configured one. */
export const LOG_LEVELS: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export const DEFAULT_LOG_LEVEL: LogLevel = "info";

/** The level named by `value` (any case, spaces ignored), or `info` when it's unset or not one of the four. */
export function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim().toLowerCase() ?? "";
  return Object.hasOwn(LOG_LEVELS, level) ? (level as LogLevel) : DEFAULT_LOG_LEVEL;
}

/**
 * The level `LOG_LEVEL` sets right now. Read from `process.env` rather than `src/lib/env.ts`, which is
 * server-only and so can't be imported here; `env.ts` parses the same variable with {@link parseLogLevel}.
 */
export function envLogLevel(): LogLevel {
  return parseLogLevel(typeof process === "undefined" ? undefined : process.env.LOG_LEVEL);
}
