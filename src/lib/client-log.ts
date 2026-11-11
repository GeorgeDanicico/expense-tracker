import { ApiError } from "@/lib/api/client";
import {
  CLIENT_ERROR_MESSAGE_MAX,
  CLIENT_ERROR_NAME_MAX,
  CLIENT_ERROR_STACK_MAX,
  CLIENT_LOG_MAX_BYTES,
  CLIENT_LOG_MAX_EVENTS,
  CLIENT_LOG_PATH,
  CLIENT_PAGE_MAX,
  isClientEvent,
  DIGEST,
  RELEASE,
  type ClientErrorEvent,
  type ClientEvent,
  type ClientVitalEvent,
  WEB_VITAL_NAMES,
  WEB_VITAL_NAVIGATION_TYPES,
  WEB_VITAL_RATINGS,
} from "@/lib/log/client-event";
import { isRequestId } from "@/lib/log/request-id";

/**
 * The browser's side of the client log (logging plan, L7): collects errors and Web Vitals and posts
 * them to `POST /api/client-log` (`src/app/api/client-log/route.ts`, whose contract is in
 * `src/lib/log/client-event.ts` and `client-report.ts`).
 *
 * Reports are queued and sent in batches: at most {@link CLIENT_LOG_MAX_EVENTS} events and
 * {@link CLIENT_LOG_MAX_BYTES} bytes a request, at most every {@link FLUSH_INTERVAL_MS}, and at once
 * when the page is hidden or closed (`pagehide`, `visibilitychange`), where `keepalive` lets the
 * request outlive the page. The endpoint refuses a whole batch for one bad field, so every event is
 * clipped to the limits and checked with the endpoint's own schema before it is queued; an event that
 * doesn't pass is dropped. A page load sends at most {@link MAX_EVENTS_PER_PAGE} events, the same
 * error at most once a minute, and nothing more after the endpoint answers 429.
 *
 * Reporting is best effort and must never be a problem itself: nothing here throws, a failed request
 * is dropped without a retry, and its failure is not reported (that could loop). It does nothing on the
 * server.
 */

/** The shortest time between two timed flushes. */
export const FLUSH_INTERVAL_MS = 5_000;
/** The most events one page load sends, errors and Web Vitals together. */
export const MAX_EVENTS_PER_PAGE = 20;
/** The most of those that Web Vitals may take, so a long session's measurements never crowd out its errors. */
export const MAX_VITALS_PER_PAGE = 10;
/** How long an error that was just reported is not reported again. */
export const DEDUPE_WINDOW_MS = 60_000;
/** The longest `Retry-After` honoured; a longer wait (or none given) stops reporting for the page. */
const MAX_RETRY_AFTER_SECONDS = 3_600;

/** `{"events":[` and `]}`, in bytes. */
const ENVELOPE_BYTES = '{"events":[]}'.length;

/** An event as the caller gives it: the reporter adds `page` and `release`, and clips the text fields. */
type WithoutContext<T> = T extends unknown ? Omit<T, "page" | "release"> : never;
export type ClientReport = WithoutContext<ClientEvent>;

type Queued = { json: string; bytes: number };

const state = {
  queue: [] as Queued[],
  timer: null as ReturnType<typeof setTimeout> | null,
  listening: false,
  /** Events queued so far this page load, and how many of them were Web Vitals. */
  accepted: 0,
  acceptedVitals: 0,
  /** When each error was last reported, by `name: message`. */
  recentErrors: new Map<string, number>(),
  /** Reporting is off until this time (a 429's `Retry-After`); `Infinity` stops it for the page. */
  pausedUntil: 0,
};

const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();

function byteLength(text: string): number {
  return encoder ? encoder.encode(text).length : text.length * 3;
}

/** `text` cut to at most `max` characters, without leaving half a surrogate pair at the end. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = text.charCodeAt(max - 1);
  return text.slice(0, end >= 0xd800 && end <= 0xdbff ? max - 1 : max);
}

/**
 * The build this page came from: the commit hash `NEXT_PUBLIC_RELEASE` was set to when the app was
 * built (see the Dockerfile), or nothing when it wasn't. It's a public value, not a secret. The
 * variable has to be named in full here for Next to put its value into the bundle.
 */
function release(): string | undefined {
  const value = process.env.NEXT_PUBLIC_RELEASE;
  return value && RELEASE.test(value) ? value : undefined;
}

/** The event with its text clipped to the endpoint's limits and its optional fields left out unless valid. */
function normalise(report: ClientReport): ClientEvent {
  const page = clip(window.location.pathname || "/", CLIENT_PAGE_MAX);
  if (report.kind === "vital") {
    const vital: ClientVitalEvent = { ...report, page, release: release() };
    return vital;
  }
  const error: ClientErrorEvent = {
    kind: "error",
    source: report.source,
    name: clip(report.name, CLIENT_ERROR_NAME_MAX) || "Error",
    message: clip(report.message, CLIENT_ERROR_MESSAGE_MAX),
    stack: report.stack ? clip(report.stack, CLIENT_ERROR_STACK_MAX) : undefined,
    digest: report.digest && DIGEST.test(report.digest) ? report.digest : undefined,
    requestId: report.requestId && isRequestId(report.requestId) ? report.requestId : undefined,
    page,
    release: release(),
  };
  return error;
}

/** Writes `event` as JSON, or null when it can't go in a request on its own (too big even without its stack). */
function serialise(event: ClientEvent): Queued | null {
  for (const candidate of event.kind === "error" && event.stack ? [event, { ...event, stack: undefined }] : [event]) {
    const json = JSON.stringify(candidate);
    const bytes = byteLength(json);
    if (bytes + ENVELOPE_BYTES <= CLIENT_LOG_MAX_BYTES) return { json, bytes };
  }
  return null;
}

/** Whether the endpoint has said to stop, or to wait. */
function isPaused(): boolean {
  return state.pausedUntil === Number.POSITIVE_INFINITY || Date.now() < state.pausedUntil;
}

/** Stops reporting after a 429: for `Retry-After` seconds when the answer gives a sensible one, else for the page. */
function pauseAfterTooManyRequests(retryAfter: string | null): void {
  const seconds = retryAfter !== null && /^\d{1,6}$/.test(retryAfter) ? Number(retryAfter) : Number.NaN;
  state.pausedUntil =
    seconds > 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? Date.now() + seconds * 1000 : Number.POSITIVE_INFINITY;
  state.queue = [];
  clearTimer();
}

function clearTimer(): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
}

/** Takes the next batch off the queue: as many events as fit in {@link CLIENT_LOG_MAX_EVENTS} and {@link CLIENT_LOG_MAX_BYTES}. */
function takeBatch(): string | null {
  const taken: string[] = [];
  let bytes = ENVELOPE_BYTES;
  while (state.queue.length > 0 && taken.length < CLIENT_LOG_MAX_EVENTS) {
    const next = state.queue[0];
    const added = next.bytes + (taken.length > 0 ? 1 : 0);
    if (bytes + added > CLIENT_LOG_MAX_BYTES) break;
    bytes += added;
    taken.push(next.json);
    state.queue.shift();
  }
  return taken.length > 0 ? `{"events":[${taken.join(",")}]}` : null;
}

function send(body: string): void {
  void Promise.resolve(
    fetch(CLIENT_LOG_PATH, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body,
    }),
  )
    .then((response) => {
      if (response?.status === 429) pauseAfterTooManyRequests(response.headers?.get("Retry-After") ?? null);
    })
    // A failed report is dropped, and not reported: a broken endpoint must not become a loop.
    .catch(() => {});
}

/**
 * Sends what is queued, in as many requests as it takes: one when the timer fires, all of it when the
 * page is hidden or closed.
 */
function flush(all: boolean): void {
  try {
    clearTimer();
    for (let batch = takeBatch(); batch !== null; batch = all ? takeBatch() : null) send(batch);
    if (state.queue.length > 0) scheduleFlush();
  } catch {
    state.queue = [];
  }
}

function scheduleFlush(): void {
  if (state.timer === null) state.timer = setTimeout(() => flush(false), FLUSH_INTERVAL_MS);
}

/** Flushes when the page is hidden or closed, the last moment a request can still be sent. */
function listen(): void {
  if (state.listening) return;
  state.listening = true;
  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
}

/**
 * Queues one error or Web Vitals measurement to be sent to the server's logs. The page (the path
 * only, never the query or fragment) and the release are added here; text past the endpoint's limits
 * is cut. An event the endpoint wouldn't take, a repeat of an error from the last minute, and
 * anything past the page's limits are dropped, as is everything once the endpoint has answered 429.
 * Never throws.
 */
export function reportClientEvent(report: ClientReport): void {
  if (typeof window === "undefined") return;
  try {
    if (isPaused()) return;

    const event = normalise(report);
    if (!isClientEvent(event)) return;

    if (state.accepted >= MAX_EVENTS_PER_PAGE) return;
    if (event.kind === "vital" && state.acceptedVitals >= MAX_VITALS_PER_PAGE) return;

    const now = Date.now();
    if (event.kind === "error") {
      const key = `${event.name}: ${event.message}`;
      for (const [seen, at] of state.recentErrors) if (now - at >= DEDUPE_WINDOW_MS) state.recentErrors.delete(seen);
      if (state.recentErrors.has(key)) return;
      const queued = serialise(event);
      if (queued === null) return;
      state.recentErrors.set(key, now);
      state.queue.push(queued);
    } else {
      const queued = serialise(event);
      if (queued === null) return;
      state.acceptedVitals += 1;
      state.queue.push(queued);
    }
    state.accepted += 1;

    listen();
    scheduleFlush();
  } catch {
    // Reporting must never be the problem.
  }
}

/** The fields of an error report that come from the thrown value: what it is, what it says, and the request it came from. */
function describe(error: unknown): Pick<ClientErrorEvent, "name" | "message" | "stack" | "requestId" | "digest"> {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack,
      requestId: error instanceof ApiError ? error.requestId : undefined,
      digest: digestOf(error),
    };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  // Anything else that was thrown (an object, a number) isn't copied: it could hold data that has no business in a log.
  return { name: "Error", message: `Non-error value thrown (${error === null ? "null" : typeof error})`, digest: digestOf(error) };
}

/** The `digest` Next puts on an error from a Server Component, which matches the server's own log of it. */
function digestOf(error: unknown): string | undefined {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" ? digest : undefined;
}

/**
 * Reports a caught error, whatever was thrown: its name, message and stack, the `requestId` of an
 * `ApiError`, and the `digest` of a server render error. `source` says where it was caught.
 */
export function reportClientError(error: unknown, source: ClientErrorEvent["source"]): void {
  try {
    reportClientEvent({ kind: "error", source, ...describe(error) });
  } catch {
    // Never throws.
  }
}

/** Browser extensions' scripts, whose errors are none of the app's business. */
const EXTENSION_SCHEME = /(?:chrome|moz|safari|safari-web)-extension:/;
/** The browser's harmless "a resize observer took another frame" notices. */
const RESIZE_OBSERVER_NOISE = /^ResizeObserver loop/;

/** Whether an error is noise: from an extension (in its file name or stack), or ResizeObserver's loop notice. */
export function isIgnoredError(parts: { message?: string; filename?: string; stack?: string }): boolean {
  const { message = "", filename = "", stack = "" } = parts;
  return RESIZE_OBSERVER_NOISE.test(message) || EXTENSION_SCHEME.test(filename) || EXTENSION_SCHEME.test(stack);
}

/** The listener for `window`'s `error` event: an uncaught error, reported as `window`. */
export function handleWindowError(event: ErrorEvent): void {
  try {
    const error: unknown = event.error;
    const thrown = error instanceof Error ? error : null;
    if (isIgnoredError({ message: event.message, filename: event.filename, stack: thrown?.stack })) return;
    reportClientError(thrown ?? event.message ?? "Script error", "window");
  } catch {
    // Never throws.
  }
}

/** The listener for `window`'s `unhandledrejection` event: a promise rejected with nobody to catch it. */
export function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  try {
    const reason: unknown = event.reason;
    const thrown = reason instanceof Error ? reason : null;
    if (isIgnoredError({ message: thrown?.message ?? (typeof reason === "string" ? reason : ""), stack: thrown?.stack })) return;
    reportClientEvent({ kind: "error", source: "unhandledrejection", ...describe(reason) });
  } catch {
    // Never throws.
  }
}

/** The shape of a measurement from `useReportWebVitals`, of which only these fields are read. */
export type WebVitalMetric = { name: string; value: number; rating?: string; navigationType?: string };

function isOneOf<T extends string>(list: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (list as readonly string[]).includes(value);
}

/** Reports one Web Vitals measurement; the ones the endpoint doesn't know (Next's own, `soft-navigation`) are left out or dropped. */
export function reportWebVital(metric: WebVitalMetric): void {
  try {
    if (!isOneOf(WEB_VITAL_NAMES, metric.name) || !isOneOf(WEB_VITAL_RATINGS, metric.rating)) return;
    reportClientEvent({
      kind: "vital",
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      navigationType: isOneOf(WEB_VITAL_NAVIGATION_TYPES, metric.navigationType) ? metric.navigationType : undefined,
    });
  } catch {
    // Never throws.
  }
}
