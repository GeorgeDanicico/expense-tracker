import { proxyRunsOn } from "@/lib/http/proxy-matcher";

/**
 * Request ids (logging plan, L2): 12 characters from `[A-Za-z0-9]` (about 71 bits), made on the
 * server for every request. A client never chooses its own: `src/proxy.ts` overwrites any
 * `x-request-id` it was sent, and a route wrapper trusts the header only when the proxy set it.
 *
 * It uses only the global `crypto`, so the proxy, route handlers, the worker and the browser can all
 * import it.
 */

/** The header the id travels in: on the request the proxy forwards, and on every API response. */
export const REQUEST_ID_HEADER = "x-request-id";
/** The internal request header that says the proxy set {@link REQUEST_ID_HEADER}; the proxy overwrites whatever a client sent. */
export const REQUEST_ID_SOURCE_HEADER = "x-request-id-source";
/** The value of {@link REQUEST_ID_SOURCE_HEADER} the proxy sets. */
export const REQUEST_ID_FROM_PROXY = "proxy";

export const REQUEST_ID_LENGTH = 12;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** The largest multiple of the alphabet's size that fits in a byte: bytes from it up are skipped, so every character is equally likely. */
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);
const REQUEST_ID = new RegExp(`^[A-Za-z0-9]{${REQUEST_ID_LENGTH}}$`);

/** A new request id from `crypto.getRandomValues`. */
export function createRequestId(): string {
  let id = "";
  while (id.length < REQUEST_ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte >= UNBIASED_LIMIT) continue;
      id += ALPHABET[byte % ALPHABET.length];
      if (id.length === REQUEST_ID_LENGTH) break;
    }
  }
  return id;
}

/** Whether `value` has the shape of a request id. */
export function isRequestId(value: string): boolean {
  return REQUEST_ID.test(value);
}

/**
 * The id the proxy gave this request, or null when there's none to trust. The header counts only
 * when the proxy's marker header is on the request and the path is one the proxy runs on: on the
 * paths it skips (`/api/mcp`, `/api/csp-report`, `/api/client-log`, the calendar feed, `/.well-known/…`) both headers
 * come straight from the client.
 */
export function proxyRequestId(headers: Headers, pathname: string): string | null {
  if (headers.get(REQUEST_ID_SOURCE_HEADER) !== REQUEST_ID_FROM_PROXY) return null;
  const id = headers.get(REQUEST_ID_HEADER);
  if (id === null || !isRequestId(id)) return null;
  return proxyRunsOn(pathname) ? id : null;
}
