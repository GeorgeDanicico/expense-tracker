import { isRequestId } from "@/lib/log/request-id";

/**
 * What a browser report is, without the schema library: the limits, the names, the types, and
 * {@link isClientEvent}, the check the browser runs on an event before it queues it (PF9).
 *
 * `client-report.ts` holds the same contract as Zod schemas for the endpoint to parse with. The
 * browser used to import those too, which shipped Zod (about 23 KiB gzipped) to every page for a
 * check the server repeats anyway. This file imports nothing but `request-id.ts`, so the browser can
 * load it without Zod, `loggable-path` or the redactor. `client-report.test.ts` runs both on the same
 * events and fails when they disagree; `client-report.ts` fails to compile when the types do.
 */

/** Where the browser sends its reports. */
export const CLIENT_LOG_PATH = "/api/client-log";
/** The largest request body read (413 past it). */
export const CLIENT_LOG_MAX_BYTES = 16 * 1024;
/** The fewest and most events in one request. */
export const CLIENT_LOG_MIN_EVENTS = 1;
export const CLIENT_LOG_MAX_EVENTS = 10;

/** The largest and smallest values the endpoint accepts: one field past its limit refuses the whole request. */
export const CLIENT_ERROR_NAME_MAX = 80;
export const CLIENT_ERROR_MESSAGE_MAX = 500;
export const CLIENT_ERROR_STACK_MAX = 4000;
/** A page is `location.pathname` (or `location.href`): a path starting with `/`, or an `http(s)` URL. */
export const CLIENT_PAGE_MAX = 2048;
/** The largest Web Vitals value accepted (milliseconds for all but CLS). */
export const CLIENT_VITAL_MAX = 600_000;

export const RELEASE = /^[A-Za-z0-9._-]{1,64}$/;
/** Next's error digest: a hash or number, never free text. */
export const DIGEST = /^[A-Za-z0-9_-]{1,64}$/;

/** Where a browser error was caught: `window.onerror`, an unhandled rejection, or an error boundary. */
export const CLIENT_ERROR_SOURCES = ["window", "unhandledrejection", "boundary", "global_boundary"] as const;
export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;
export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
/** The `navigationType` values the `web-vitals` library reports. */
export const WEB_VITAL_NAVIGATION_TYPES = ["navigate", "reload", "back-forward", "back-forward-cache", "prerender", "restore"] as const;

/** A browser error. `requestId` is the `x-request-id` of the API response that caused it, if any. */
export type ClientErrorEvent = {
  kind: "error";
  source: (typeof CLIENT_ERROR_SOURCES)[number];
  name: string;
  message: string;
  stack?: string | undefined;
  digest?: string | undefined;
  requestId?: string | undefined;
  page: string;
  release?: string | undefined;
};

/** One Web Vitals measurement, as `useReportWebVitals` gives it. */
export type ClientVitalEvent = {
  kind: "vital";
  name: (typeof WEB_VITAL_NAMES)[number];
  value: number;
  rating: (typeof WEB_VITAL_RATINGS)[number];
  navigationType?: (typeof WEB_VITAL_NAVIGATION_TYPES)[number] | undefined;
  page: string;
  release?: string | undefined;
};

export type ClientEvent = ClientErrorEvent | ClientVitalEvent;

/** Whether `page` is a path (`/…`, not `//…`) or an absolute `http(s)` URL. */
export function isPage(page: string): boolean {
  if (page.startsWith("/")) return !page.startsWith("//");
  try {
    const url = new URL(page);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const isString = (value: unknown, max: number, min = 0): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);
/** Absent, or (like Zod's `.optional()`) `undefined`. */
const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);

const ERROR_KEYS = new Set(["kind", "source", "name", "message", "stack", "digest", "requestId", "page", "release"]);
const VITAL_KEYS = new Set(["kind", "name", "value", "rating", "navigationType", "page", "release"]);

const hasOnly = (value: object, keys: Set<string>) => Object.keys(value).every((key) => keys.has(key));

/** Whether `value` is a report the endpoint would take: the same rules as `clientEventSchema`, unknown keys refused. */
export function isClientEvent(value: unknown): value is ClientEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const common = isString(event.page, CLIENT_PAGE_MAX, 1) && isPage(event.page) && isOptional(event.release, (release) => typeof release === "string" && RELEASE.test(release));
  if (!common) return false;
  if (event.kind === "error") {
    return (
      hasOnly(event, ERROR_KEYS) &&
      isOneOf(CLIENT_ERROR_SOURCES, event.source) &&
      isString(event.name, CLIENT_ERROR_NAME_MAX, 1) &&
      isString(event.message, CLIENT_ERROR_MESSAGE_MAX) &&
      isOptional(event.stack, (stack) => isString(stack, CLIENT_ERROR_STACK_MAX)) &&
      isOptional(event.digest, (digest) => typeof digest === "string" && DIGEST.test(digest)) &&
      isOptional(event.requestId, (id) => typeof id === "string" && isRequestId(id))
    );
  }
  if (event.kind === "vital") {
    return (
      hasOnly(event, VITAL_KEYS) &&
      isOneOf(WEB_VITAL_NAMES, event.name) &&
      typeof event.value === "number" &&
      Number.isFinite(event.value) &&
      event.value >= 0 &&
      event.value <= CLIENT_VITAL_MAX &&
      isOneOf(WEB_VITAL_RATINGS, event.rating) &&
      isOptional(event.navigationType, (type) => isOneOf(WEB_VITAL_NAVIGATION_TYPES, type))
    );
  }
  return false;
}
