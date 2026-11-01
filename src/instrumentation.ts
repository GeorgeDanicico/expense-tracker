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
