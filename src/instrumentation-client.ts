// A module, though it exports nothing: Next runs it for its side effects.
export {};

/**
 * Runs in the browser before any of the app's own modules (Next's `instrumentation-client`).
 *
 * Zod runs without its compiled fast path (`jitless`) in the browser. Otherwise every `z.object`
 * probes for `eval` with `new Function("")` when it is created, at module load: the CSP (security
 * plan S7) forbids `eval`, so the probe is a `script-src` violation report on every page that loads
 * a schema, even though Zod catches the error and falls back to the code this setting picks. It must
 * run before the first schema is created, which is why it is here and not in a component. The server
 * keeps the fast path: no CSP applies there.
 *
 * It sets the flag on the object Zod keeps its settings in (`globalThis.__zod_globalConfig`, what
 * `z.config()` writes to) instead of importing Zod: importing anything from Zod here put its whole core,
 * about 23 KiB gzipped, in the first load of every page, for one line (PF9). `instrumentation-client.test.ts`
 * checks that Zod still reads the flag from there, so an upgrade that moves it fails a test.
 */
const zod = globalThis as typeof globalThis & { __zod_globalConfig?: { jitless?: boolean } };
(zod.__zod_globalConfig ??= {}).jitless = true;

/**
 * Errors nothing caught, sent to the server's logs through `src/lib/client-log.ts` (logging plan,
 * L7): an uncaught error, and a promise rejected with no handler (an `ApiError` among them, which
 * carries the `requestId` of the failed request). Errors an error boundary catches are reported by
 * the boundary.
 *
 * The reporter is loaded when the first error happens, not imported here: it builds Zod schemas when
 * it loads, and an import is evaluated before the `z.config` call above.
 */
window.addEventListener("error", (event) => {
  void import("@/lib/client-log").then((log) => log.handleWindowError(event)).catch(() => {});
});
window.addEventListener("unhandledrejection", (event) => {
  void import("@/lib/client-log").then((log) => log.handleUnhandledRejection(event)).catch(() => {});
});
