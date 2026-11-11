import { redirectToLoginIfUnauthorized } from "@/lib/api/auth-redirect";
import { isRequestId, REQUEST_ID_HEADER } from "@/lib/log/request-id";

export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;
  /** A machine-readable reason, for the few refusals a screen tells apart (an import's `unrecognised_layout`). */
  code?: string;
  /**
   * The server's id for the request that failed (`x-request-id`, or the 500 body's `requestId`), the
   * key to its line in the logs. Errors the browser made up itself (no connection, a timeout) have none.
   */
  requestId?: string;

  constructor(
    message: string,
    status: number,
    fieldErrors?: Record<string, string[]>,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
    this.requestId = requestId;
  }
}

type ErrorPayload = { error?: string; fieldErrors?: Record<string, string[]>; code?: string; requestId?: string };
const REQUEST_TIMEOUT_MS = 15_000;

/** The `code` of the error the client makes up when a request took too long: it already waited, so it isn't retried. */
export const TIMEOUT_CODE = "timeout";
/** The `code` of the error made up while the device has no connection. */
export const OFFLINE_CODE = "offline";
export const OFFLINE_MESSAGE = "You're offline. Reconnect to load your data.";
/** SWR's `dedupingInterval` (`provider.tsx`): how long a fetched answer counts as fresh enough not to ask again on mount. */
export const DEDUPING_INTERVAL_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError("The request took too long. Check your connection and try again.", 504, undefined, TIMEOUT_CODE);
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ApiError(OFFLINE_MESSAGE, 503, undefined, OFFLINE_CODE);
    }
    throw new ApiError("Unable to reach the server. Check your connection and try again.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

// ---- how long a read may keep trying ----------------------------------------------------------------
//
// A read that fails shows its error within `LOAD_BUDGET_MS` of its first try: SWR's retries share that
// time, and each retry's own timeout is cut to what is left of it.

const LOAD_BUDGET_MS = REQUEST_TIMEOUT_MS;
const RETRY_DELAY_MS = 3_000;
/** A retry with less time than this left isn't worth starting. */
const MIN_RETRY_MS = 2_000;

/** When each read's current attempt began, and which reads are waiting to retry. */
const firstTries = new Map<string, number>();
const retrying = new Set<string>();

/**
 * How long to wait before retrying a failed read, or `null` to give up and show the error. Only a
 * server failure is worth retrying: not a 4xx (the same request fails again), not a timeout (it
 * already waited as long as it may), not an offline device (SWR reloads when it's back), and not
 * when the retries would run past the budget.
 */
export function retryDelay(key: string, error: unknown, retryCount: number, maxRetries: number, now = Date.now()): number | null {
  const worthRetrying =
    !(error instanceof ApiError) ||
    ((error.status >= 500 || error.status === 429) && error.code !== TIMEOUT_CODE && error.code !== OFFLINE_CODE);
  const start = firstTries.get(key) ?? now;
  if (!worthRetrying || retryCount > maxRetries || start + LOAD_BUDGET_MS - (now + RETRY_DELAY_MS) < MIN_RETRY_MS) {
    firstTries.delete(key);
    return null;
  }
  retrying.add(key);
  return RETRY_DELAY_MS;
}

/** The request id a failed response carries: the header the API sets on every response, else the 500 body's. Anything not shaped like an id is ignored. */
function responseRequestId(response: Response, payload: ErrorPayload): string | undefined {
  const candidates = [response.headers.get(REQUEST_ID_HEADER), payload.requestId];
  return candidates.find((id): id is string => typeof id === "string" && isRequestId(id));
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    // The session ended while the app was open: sign in again, whichever request found out.
    redirectToLoginIfUnauthorized(response.status);
    const message = payload.error || "Something went wrong. Please try again.";
    const requestId = responseRequestId(response, payload);
    throw new ApiError(
      // A server failure shows its id, so whoever hits it can quote it; a 4xx is the user's to fix and needs none.
      response.status >= 500 && requestId ? `${message} (ref ${requestId})` : message,
      response.status,
      payload.fieldErrors,
      typeof payload.code === "string" ? payload.code : undefined,
      requestId,
    );
  }
  return payload;
}

export async function apiFetcher<T>(url: string): Promise<T> {
  const now = Date.now();
  // A retry carries on from the first try's start; anything else starts its own budget.
  const start = retrying.delete(url) ? (firstTries.get(url) ?? now) : now;
  firstTries.set(url, start);
  const response = await fetchWithTimeout(
    url,
    { cache: "no-store", credentials: "same-origin" },
    Math.min(REQUEST_TIMEOUT_MS, start + LOAD_BUDGET_MS - now),
  );
  const payload = await parseResponse<T>(response);
  firstTries.delete(url);
  return payload;
}

export async function apiRequest<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return parseResponse<T>(response);
}
