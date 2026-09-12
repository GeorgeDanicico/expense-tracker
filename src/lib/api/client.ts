export class ApiError extends Error {
  status: number;
  fieldErrors?: Record<string, string[]>;

  constructor(message: string, status: number, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

type ErrorPayload = { error?: string; fieldErrors?: Record<string, string[]> };
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

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new ApiError(
      payload.error || "Something went wrong. Please try again.",
      response.status,
      payload.fieldErrors,
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
