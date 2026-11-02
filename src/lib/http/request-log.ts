import "server-only";

import { getEnv } from "@/lib/env";
import { errorFields, log, type LogFields, type LogLevel } from "@/lib/log";
import { createRequestContext, currentRequest, runWithRequestContext, type RequestContext } from "@/lib/log/request-context";
import { REQUEST_ID_HEADER } from "@/lib/log/request-id";

/**
 * One `request` line per API request (logging plan, L2). The route wrappers (`withUser`,
 * `withRequestGuard`, `withAnonymousLimit`) and the two routes without one (`/api/mcp`,
 * `/api/csp-report`) run through {@link logRequest}. `/health` doesn't: Docker calls it every few
 * seconds.
 */

/** The fields the request line sets itself, which a handler's `addRequestFields` can't replace. */
const LINE_KEYS: ReadonlySet<string> = new Set(["requestId", "method", "route", "status", "ms", "userId", "slow", "spans"]);

// Errors already written as `request_failed`, so a wrapper that rethrows one doesn't write it twice.
const loggedFailures = new WeakSet<object>();

/** Whether `error` was already logged as a request's `request_failed` line (L3's `onRequestError` skips those). */
export function isLoggedRequestFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && loggedFailures.has(error);
}

/**
 * Writes `request_failed` at `error` for an unexpected error in the current request, with
 * `errorFields(error)`, once per error. Called before the 500 is answered (or the error rethrown).
 */
export function logRequestFailure(error: unknown): void {
  if (isLoggedRequestFailure(error)) return;
  const context = currentRequest();
  log.error("request_failed", { ...errorFields(error), method: context?.method, route: context?.route, userId: context?.userId });
  if (typeof error === "object" && error !== null) loggedFailures.add(error);
}

/** `response` with `x-request-id` set, copied first when its headers are immutable (a `fetch` response, `Response.redirect`). */
export function withRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

export type LogRequestOptions = {
  /**
   * Writes the line at `debug` instead of `info`, and a 429 at `debug` instead of `warn`, for a
   * route whose floods shouldn't drown real traffic (`/api/csp-report`). Slow requests and 5xx keep
   * their levels.
   */
  quiet?: boolean;
};

function lineLevel(status: number, slow: boolean, quiet: boolean): LogLevel {
  if (status >= 500) return "error";
  if (slow) return "warn";
  if (quiet) return "debug";
  return status === 429 ? "warn" : "info";
}

function writeRequestLine(context: RequestContext, status: number, quiet: boolean): void {
  const ms = Math.round(performance.now() - context.startedAt);
  const slow = ms > getEnv().LOG_SLOW_MS;
  const fields: LogFields = {
    method: context.method,
    route: context.route,
    status,
    ms,
    userId: context.userId,
    slow: slow || undefined,
    spans: context.spans,
  };
  for (const [key, value] of Object.entries(context.fields)) if (!LINE_KEYS.has(key)) fields[key] = value;
  log[lineLevel(status, slow, quiet)]("request", fields);
}

/**
 * Runs `handle` as one request: inside a new request context (so every line it writes carries the
 * request id), then sets `x-request-id` on its response and writes one `request` line
 * `{ method, route, status, ms, userId?, slow?, spans, ...fields }`. The level is `info`, `warn`
 * when the request took longer than `LOG_SLOW_MS` (with `slow: true`) or answered 429, and `error`
 * for 5xx.
 *
 * An error `handle` throws is logged as `request_failed` (unless already logged), counted as a 500
 * in the line, and rethrown unchanged, so Next answers it as before. Inside a request that already
 * has a context (a wrapper inside another), it just runs `handle`: the outer one writes the line.
 */
export async function logRequest(
  request: Request | undefined,
  handle: () => Promise<Response>,
  { quiet = false }: LogRequestOptions = {},
): Promise<Response> {
  if (currentRequest()) return handle();

  const context = createRequestContext(request);
  return runWithRequestContext(context, async () => {
    let response: Response;
    try {
      response = await handle();
    } catch (error) {
      logRequestFailure(error);
      writeRequestLine(context, 500, quiet);
      throw error;
    }
    const tagged = withRequestIdHeader(response, context.requestId);
    writeRequestLine(context, tagged.status, quiet);
    return tagged;
  });
}
