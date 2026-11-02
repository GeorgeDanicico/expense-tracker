/**
 * The paths `src/proxy.ts` runs on, for code that needs to know whether a request went through it
 * (the request id's trust rule in `src/lib/log/request-id.ts`).
 *
 * Next reads the proxy's `config.matcher` statically at build time, so `src/proxy.ts` must keep its
 * own copy as a string literal; `src/proxy.test.ts` checks the two are the same string.
 */
export const PROXY_MATCHER =
  "/((?!health(?:/|$)|api/mcp(?:/|$)|api/csp-report(?:/|$)|api/calendar/feed/|\\.well-known/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)";

// Next compiles the matcher with path-to-regexp; as a plain regular expression over the whole path
// it means the same thing for this pattern.
const PROXY_PATH = new RegExp(`^${PROXY_MATCHER}$`);

/**
 * Whether the proxy runs on `pathname`. A percent-encoded path counts only when it matches both as
 * sent and decoded, so `/api/%6dcp` can't pass for a path the proxy saw.
 */
export function proxyRunsOn(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: only the path as sent is checked.
  }
  return PROXY_PATH.test(pathname) && PROXY_PATH.test(decoded);
}
