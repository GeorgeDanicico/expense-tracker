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

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError("The request took too long. Check your connection and try again.", 504);
    }
    throw new ApiError("Unable to reach the server. Check your connection and try again.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

/** The request id a failed response carries: the header the API sets on every response, else the 500 body's. Anything not shaped like an id is ignored. */
function responseRequestId(response: Response, payload: ErrorPayload): string | undefined {
  const candidates = [response.headers.get(REQUEST_ID_HEADER), payload.requestId];
  return candidates.find((id): id is string => typeof id === "string" && isRequestId(id));
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
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
  const response = await fetchWithTimeout(url, {
    cache: "no-store",
    credentials: "same-origin",
  });
  return parseResponse<T>(response);
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
