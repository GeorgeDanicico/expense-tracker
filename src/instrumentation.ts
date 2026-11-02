import type { Instrumentation } from "next";

/**
 * Runs once when the Next.js server starts, before it answers a request (see "instrumentation.js"
 * in the Next.js docs). It checks the environment, so a missing required variable stops the
 * container with a clear message instead of failing on the first request that needs it.
 *
 * `register` is called in every runtime, and the check uses Node.js APIs (`process.exit`), so it
 * lives in its own file that only the Node.js runtime imports. `next build` does not call `register`,
 * so CI builds without the production variables.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkWebEnvironment } = await import("./instrumentation-node");
    checkWebEnvironment();
  }
}

/**
 * Called by Next for every server error it catches (logging plan, L3): one `server_render_failed`
 * line, so a Server Component that throws shows up in the logs with its digest and request id.
 * Node.js runtime only, like `register`, and it must be awaited.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logRequestError } = await import("./instrumentation-node");
    logRequestError(err, request, context);
  }
};
