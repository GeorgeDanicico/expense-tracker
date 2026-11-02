import { z } from "zod";

import type { LogFields } from "@/lib/log";
import { loggablePagePath, loggableResourcePath } from "@/lib/log/loggable-path";
import { redactString } from "@/lib/log/redact";
import { isRequestId } from "@/lib/log/request-id";

/**
 * The browser's error and Web Vitals reports (logging plan, L6): the request `POST /api/client-log`
 * takes, and how each event is made safe to log. The browser reporter (L7) builds its requests from
 * the schema and limits here.
 *
 * It imports nothing server-only (no `next/*`, no `server-only`, no environment), so client code can
 * import the contract from it; the app's origin, which only the server knows, is passed in.
 *
 * SECURITY: everything in a report is written by whoever sends it, signed out included, and lands in
 * the logs. The schema is strict (unknown keys are refused) and bounds every field; then
 * {@link clientEventFields} keeps only what is worth a line: the page as a path with ids replaced,
 * stack frames as `function@path:line:col` for the app's own scripts and as the origin alone for
 * any other, with no query strings and at most {@link MAX_STACK_FRAMES} frames, and the message
 * redacted like any logged string. The logger redacts every field again when it writes the line.
 */

/** Where the browser sends its reports. */
export const CLIENT_LOG_PATH = "/api/client-log";
/** The largest request body read (413 past it). */
export const CLIENT_LOG_MAX_BYTES = 16 * 1024;
/** The fewest and most events in one request. */
export const CLIENT_LOG_MIN_EVENTS = 1;
export const CLIENT_LOG_MAX_EVENTS = 10;

/** Field limits, in characters, which the reporter clips to before sending: one field past its limit refuses the whole request. */
export const CLIENT_ERROR_NAME_MAX = 80;
export const CLIENT_ERROR_MESSAGE_MAX = 500;
export const CLIENT_ERROR_STACK_MAX = 4000;
/** A page is `location.pathname` (or `location.href`): a path starting with `/`, or an `http(s)` URL. */
export const CLIENT_PAGE_MAX = 2048;
/** The largest Web Vitals value accepted (milliseconds for all but CLS). */
export const CLIENT_VITAL_MAX = 600_000;

/** The most stack frames logged per error. */
export const MAX_STACK_FRAMES = 15;
/** The most characters kept of a frame's function name. */
const MAX_FUNCTION_LENGTH = 80;
/** The largest line or column number kept. */
const MAX_POSITION = 10_000_000;

const RELEASE = /^[A-Za-z0-9._-]{1,64}$/;
/** Next's error digest: a hash or number, never free text. */
const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;

/** What the endpoint answers, with status 400, to any body that isn't a valid report. */
export const NOT_A_CLIENT_REPORT = "That isn't a client report.";

/** Whether `page` is a path (`/…`, not `//…`) or an absolute `http(s)` URL. */
function isPage(page: string): boolean {
  if (page.startsWith("/")) return !page.startsWith("//");
  try {
    const url = new URL(page);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const pageSchema = z.string().min(1).max(CLIENT_PAGE_MAX).refine(isPage);
const releaseSchema = z.string().regex(RELEASE);

/** Where a browser error was caught: `window.onerror`, an unhandled rejection, or an error boundary. */
export const CLIENT_ERROR_SOURCES = ["window", "unhandledrejection", "boundary", "global_boundary"] as const;
export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;
export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
/** The `navigationType` values the `web-vitals` library reports. */
export const WEB_VITAL_NAVIGATION_TYPES = ["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"] as const;

/** A browser error. `requestId` is the `x-request-id` of the API response that caused it, if any. */
export const clientErrorEventSchema = z.strictObject({
  kind: z.literal("error"),
  source: z.enum(CLIENT_ERROR_SOURCES),
  name: z.string().min(1).max(CLIENT_ERROR_NAME_MAX),
  message: z.string().max(CLIENT_ERROR_MESSAGE_MAX),
  stack: z.string().max(CLIENT_ERROR_STACK_MAX).optional(),
  digest: z.string().regex(DIGEST).optional(),
  requestId: z.string().refine(isRequestId).optional(),
  page: pageSchema,
  release: releaseSchema.optional(),
});

/** One Web Vitals measurement, as `useReportWebVitals` gives it. */
export const clientVitalEventSchema = z.strictObject({
  kind: z.literal("vital"),
  name: z.enum(WEB_VITAL_NAMES),
  value: z.number().min(0).max(CLIENT_VITAL_MAX),
  rating: z.enum(WEB_VITAL_RATINGS),
  navigationType: z.enum(WEB_VITAL_NAVIGATION_TYPES).optional(),
  page: pageSchema,
  release: releaseSchema.optional(),
});

export const clientEventSchema = z.discriminatedUnion("kind", [clientErrorEventSchema, clientVitalEventSchema]);

/** The body of `POST /api/client-log`, sent as `application/json`. */
export const clientLogBodySchema = z.strictObject({
  events: z.array(clientEventSchema).min(CLIENT_LOG_MIN_EVENTS).max(CLIENT_LOG_MAX_EVENTS),
});

export type ClientErrorEvent = z.infer<typeof clientErrorEventSchema>;
export type ClientVitalEvent = z.infer<typeof clientVitalEventSchema>;
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ClientLogBody = z.infer<typeof clientLogBodySchema>;

/** Whose scripts a stack frame may name by path: the app's own origin (the server decides, see `isAppOrigin`). */
export type IsAppOrigin = (origin: string) => boolean;

/** A page (a path or URL) as a path only, with ids replaced as in the request line's route template. */
export function sanitizePage(page: string): string {
  let pathname: string;
  try {
    pathname = new URL(page, "http://page.invalid").pathname;
  } catch {
    return "unknown";
  }
  return loggablePagePath(pathname);
}

/**
 * A frame's function name (or an error's name): redacted, without characters no function name has,
 * and redacted again (dropping a character could join a secret back together), then clipped.
 */
function functionName(raw: string): string {
  const stripped = redactString(raw).replace(/[^\w$.<>[\]/*#~ -]/g, "").replace(/\s+/g, " ").trim();
  const name = redactString(stripped);
  return name.length > MAX_FUNCTION_LENGTH ? name.slice(0, MAX_FUNCTION_LENGTH) : name;
}

function position(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < MAX_POSITION ? number : undefined;
}

/**
 * Where a frame points, as logged: `path:line:col` for the app's own scripts, the origin alone for
 * any other, the scheme alone for `blob:`, `chrome-extension:` and the like, `native` or `eval` for
 * those; null when it's none of these (so the line isn't a frame).
 */
function frameLocation(raw: string, isAppOrigin: IsAppOrigin): string | null {
  const location = raw.trim();
  if (location.includes("eval at ")) return "eval";
  if (location === "native" || location === "[native code]") return "native";
  if (location === "<anonymous>") return "anonymous";

  const match = location.match(/^(.*?)(?::(\d+))?(?::(\d+))?$/);
  if (!match) return null;
  const [, address, line, column] = match;

  let path: string;
  if (address.startsWith("/") && !address.startsWith("//")) {
    path = loggableResourcePath(address);
  } else {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      const scheme = url.protocol.slice(0, -1);
      return /^[a-z][a-z0-9+.-]{0,30}$/.test(scheme) ? scheme : null;
    }
    if (!isAppOrigin(url.origin)) return redactString(url.origin);
    path = loggableResourcePath(url.pathname);
  }

  const lineNumber = position(line);
  const columnNumber = position(column);
  if (lineNumber === undefined) return path;
  return columnNumber === undefined ? `${path}:${lineNumber}` : `${path}:${lineNumber}:${columnNumber}`;
}

/**
 * One line of a stack as `function@location`, or null when the line isn't a frame (V8's first line
 * repeats the message; anything that doesn't parse is dropped). Reads V8's `at fn (location)` and
 * `at location`, and Firefox's and Safari's `fn@location`.
 */
function sanitizeFrame(line: string, isAppOrigin: IsAppOrigin): string | null {
  const trimmed = line.trim();
  let name: string;
  let rawLocation: string;

  const v8 = trimmed.match(/^at\s+(.*)$/);
  if (v8) {
    const rest = v8[1];
    const open = rest.indexOf(" (");
    if (open !== -1 && rest.endsWith(")")) {
      name = rest.slice(0, open);
      rawLocation = rest.slice(open + 2, -1);
    } else {
      name = "";
      rawLocation = rest;
    }
  } else {
    const at = trimmed.indexOf("@");
    if (at === -1) return null;
    name = trimmed.slice(0, at);
    rawLocation = trimmed.slice(at + 1);
  }

  const location = frameLocation(rawLocation, isAppOrigin);
  return location === null ? null : `${functionName(name)}@${location}`;
}

/**
 * A stack as at most {@link MAX_STACK_FRAMES} frames, each `function@path:line:col` for the app's own
 * scripts (`isAppOrigin`) and `function@origin` for any other: no query strings, no fragments, no
 * other origin's paths, and no line that isn't a frame.
 */
export function sanitizeStack(stack: string, isAppOrigin: IsAppOrigin): string[] {
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    if (frames.length === MAX_STACK_FRAMES) break;
    const frame = sanitizeFrame(line, isAppOrigin);
    if (frame !== null) frames.push(frame);
  }
  return frames;
}

/** An identifier (a release or a digest) as it is, or left out when redaction would change it: half a value is no use. */
function cleanIdentifier(value: string | undefined): string | undefined {
  return value !== undefined && redactString(value) === value ? value : undefined;
}

/** The fields of a `client_error` line. */
function errorFields(event: ClientErrorEvent, isAppOrigin: IsAppOrigin): LogFields {
  const stack = event.stack === undefined ? undefined : sanitizeStack(event.stack, isAppOrigin);
  return {
    page: sanitizePage(event.page),
    source: event.source,
    // The same shape as a server error's `errorFields`, so a log viewer reads both alike.
    error: {
      name: functionName(event.name) || "Error",
      message: redactString(event.message),
      ...(stack && stack.length > 0 ? { stack } : {}),
    },
    digest: cleanIdentifier(event.digest),
    relatedRequestId: event.requestId,
    release: cleanIdentifier(event.release),
  };
}

/** The fields of a `web_vital` line. */
function vitalFields(event: ClientVitalEvent): LogFields {
  return {
    page: sanitizePage(event.page),
    name: event.name,
    // Four decimals: CLS is a small fraction, the others are milliseconds.
    value: Math.round(event.value * 10_000) / 10_000,
    rating: event.rating,
    navigationType: event.navigationType,
    release: cleanIdentifier(event.release),
  };
}

/**
 * The event name, level and fields to log one checked event under: `client_error` at `warn` (the
 * browser's error, not the server's) or `web_vital` at `info`. The caller adds `userId`; the request
 * context adds the endpoint request's own `requestId`.
 */
export function clientEventLine(
  event: ClientEvent,
  isAppOrigin: IsAppOrigin,
): { event: "client_error" | "web_vital"; level: "warn" | "info"; fields: LogFields } {
  return event.kind === "error"
    ? { event: "client_error", level: "warn", fields: errorFields(event, isAppOrigin) }
    : { event: "web_vital", level: "info", fields: vitalFields(event) };
}
