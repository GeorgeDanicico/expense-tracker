/** How serious a line is, lowest first. `LOG_LEVEL` sets the lowest one written. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** A value a log line can hold: what `JSON.stringify` writes without losing anything. */
export type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue };

/** Structured log fields. A field whose value is `undefined` is dropped, so optional values need no `if`. */
export type LogFields = Record<string, LogValue | undefined>;

/** Writes one finished line, newline included. */
export type Write = (line: string) => void;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger whose every line also carries `fields`. */
  child(fields: LogFields): Logger;
}
