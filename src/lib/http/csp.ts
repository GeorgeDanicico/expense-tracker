/**
 * The Content Security Policy (security plan S7). `src/proxy.ts` makes a fresh nonce for every
 * request, builds the policy with it, and sends it twice:
 * - on the request, so Next finds the nonce while rendering and puts it on its own scripts
 *   (Next reads `Content-Security-Policy` or, failing that, `Content-Security-Policy-Report-Only`),
 *   together with `x-nonce` for the root layout, which hands it to next-themes' inline script;
 * - on the response, so the browser checks the page against it.
 *
 * For now it is report-only ({@link CSP_HEADER}): nothing is blocked, and every violation is sent
 * to `POST /api/csp-report`, which logs it. S14 switches to `Content-Security-Policy` after a week
 * of clean reports.
 */

/** The header the policy goes out in. S14 changes this one constant to enforce it. */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/** The request header the root layout reads the nonce from. */
export const NONCE_HEADER = "x-nonce";

/** Where browsers send violation reports. */
export const CSP_REPORT_PATH = "/api/csp-report";

/** The Reporting API endpoint name the policy's `report-to` refers to. */
export const CSP_REPORT_GROUP = "csp-endpoint";

/** The `Reporting-Endpoints` header value that names {@link CSP_REPORT_GROUP}. */
export const REPORTING_ENDPOINTS = `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`;

/** A nonce: 128 random bits, base64. Unpredictable and new for every request. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The policy for one response. `dev` adds `'unsafe-eval'`, which React needs in development only
 * (it rebuilds server error stacks in the browser with `eval`).
 */
export function contentSecurityPolicy({ nonce, dev }: { nonce: string; dev: boolean }): string {
  const directives: Record<string, string[]> = {
    // Anything not listed below: only the app's own origin.
    "default-src": ["'self'"],
    // Only scripts carrying this response's nonce (Next's own, next-themes'), and whatever they
    // load ('strict-dynamic': Next's chunks). 'self' is ignored by browsers that understand
    // 'strict-dynamic' and kept for those that don't.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Chakra UI (Emotion) and next-themes insert <style> elements and style attributes at runtime.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Avatars come from /api/avatars; `data:` and `blob:` cover inline SVGs and the avatar preview.
    "img-src": ["'self'", "data:", "blob:"],
    // next/font serves Geist from /_next/static.
    "font-src": ["'self'"],
    // Every fetch goes to the app's own /api (in development also Next's HMR websocket, which
    // 'self' covers).
    "connect-src": ["'self'"],
    // The service worker (/sw.js) and the web app manifest.
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Every form submits through fetch; none posts to another site.
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    // `report-uri` for browsers without the Reporting API (Firefox, Safari); browsers with it use
    // `report-to` and ignore `report-uri`.
    "report-uri": [CSP_REPORT_PATH],
    "report-to": [CSP_REPORT_GROUP],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}
