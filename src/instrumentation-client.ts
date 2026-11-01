import { z } from "zod";

/**
 * Runs in the browser before any of the app's own modules (Next's `instrumentation-client`).
 *
 * Zod runs without its compiled fast path (`jitless`) in the browser. Otherwise every `z.object`
 * probes for `eval` with `new Function("")` when it is created, at module load: the CSP (security
 * plan S7) forbids `eval`, so the probe is a `script-src` violation report on every page that loads
 * a schema, even though Zod catches the error and falls back to the code this setting picks. It must
 * run before the first schema is created, which is why it is here and not in a component. The server
 * keeps the fast path: no CSP applies there.
 */
z.config({ jitless: true });
