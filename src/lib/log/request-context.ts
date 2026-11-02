import { AsyncLocalStorage } from "node:async_hooks";

import { setLogContext, type LogFields } from "@/lib/log";
import { createRequestId, proxyRequestId } from "@/lib/log/request-id";
import { routeTemplate } from "@/lib/log/route-template";

/**
 * The current request's context (logging plan, L2): its id, route and start, who asked, the spans
 * timed inside it and the fields a handler adds, kept in an `AsyncLocalStorage` so code deep inside
 * a request (a repository, a Supabase call) reaches it without being passed it. Loading this module
 * points the shared logger at it (`setLogContext`), so every line written inside a request carries
 * its `requestId`.
 *
 * It's a separate store from `runWithSupabaseClient`'s in `src/lib/supabase/server.ts`, on purpose:
 * that one decides who a database call acts as, this one only describes the request.
 *
 * Node-only (`node:async_hooks`), so it stays out of `src/lib/log/index.ts`, which client code imports.
 */

/** One timed call inside a request, as the request line lists it. `count` is set when several calls of one name are merged. */
export type Span = { name: string; ms: number; count?: number; error?: true; status?: number };

export type RequestContext = {
  requestId: string;
  method: string;
  /** The route template (`/api/expenses/:id`), never the raw path. */
  route: string;
  /** When the request started, from `performance.now()`. */
  startedAt: number;
  /** The signed-in caller, once the wrapper knows them. */
  userId?: string;
  spans: Span[];
  /** Extra fields for the request line (`familyId`, `mcpTool`). */
  fields: LogFields;
};

// One store per process, even if a bundler loads this module more than once (Next's layers, dev reloads).
const STORE_KEY = Symbol.for("expense-tracker.request-context");
const globalStore = globalThis as typeof globalThis & { [STORE_KEY]?: AsyncLocalStorage<RequestContext> };
const store = (globalStore[STORE_KEY] ??= new AsyncLocalStorage<RequestContext>());

setLogContext(() => {
  const context = store.getStore();
  return context ? { requestId: context.requestId } : undefined;
});

/**
 * A new context for `request`: the proxy's id when it gave the request one (see `proxyRequestId`),
 * otherwise a new one; the method; and the route template of its path. A missing `request` (a test
 * calling a handler directly) is a `GET` of `unknown`.
 */
export function createRequestContext(request: Request | undefined, startedAt: number = performance.now()): RequestContext {
  let pathname: string | null = null;
  try {
    if (request) pathname = new URL(request.url).pathname;
  } catch {
    // Not a URL: the route is unknown and the id is new.
  }
  const trusted = request && pathname !== null ? proxyRequestId(request.headers, pathname) : null;
  return {
    requestId: trusted ?? createRequestId(),
    method: request?.method.toUpperCase() ?? "GET",
    route: pathname === null ? "unknown" : routeTemplate(pathname),
    startedAt,
    spans: [],
    fields: {},
  };
}

/** Runs `fn` with `context` as the current request, for everything it awaits or starts. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return store.run(context, fn);
}

/** The current request's context, or `undefined` outside a request. */
export function currentRequest(): RequestContext | undefined {
  return store.getStore();
}

/** Records the signed-in caller on the current request; does nothing outside one. */
export function setRequestUser(userId: string): void {
  const context = store.getStore();
  if (context) context.userId = userId;
}

/**
 * Adds fields to the current request's line (say `familyId` or `importId`); later values replace
 * earlier ones. Does nothing outside a request. The fields go through the logger's redaction like any
 * other, so name them for what they hold (`errorCode`, not `code`).
 */
export function addRequestFields(fields: LogFields): void {
  const context = store.getStore();
  if (context) Object.assign(context.fields, fields);
}
