import type { Instrumentation } from "next";

import { checkEnv, optionalFeaturesOff } from "@/lib/env";
import { isLoggedRequestFailure } from "@/lib/http/request-log";
import { errorFields, log } from "@/lib/log";
import { proxyRequestId } from "@/lib/log/request-id";
import { routeTemplate } from "@/lib/log/route-template";

/**
 * The web app's start-up check: a missing or invalid required variable writes one `env_check_failed`
 * line naming it (never a value) and exits with 1; a missing optional one only writes one
 * `env_optional_off` line saying what is off.
 *
 * It runs before anything else, so it uses only the shared logger, which reads `LOG_LEVEL` from
 * `process.env` itself and needs nothing from `src/lib/env.ts` to have been checked first.
 */
export function checkWebEnvironment() {
  const result = checkEnv("web");
  if (!result.ok) {
    log.error("env_check_failed", {
      process: "web",
      problems: result.problems,
      hint: "Set them in the container's env file (see .env.example) and start again. Values are never logged.",
    });
    process.exit(1);
  }

  const off = optionalFeaturesOff();
  if (off.length > 0) log.info("env_optional_off", { off });
}

/** The header values `request` carries, as `Headers` (Next gives a string or a list of them per name). */
function toHeaders(source: { [key: string]: string | string[] | undefined }): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(source)) {
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(name, item);
  }
  return headers;
}

/**
 * Writes `server_render_failed` at `error` for an error Next caught outside the route wrappers (a
 * Server Component that threw, a server action, a route without a wrapper): `errorFields(err)`,
 * Next's `digest` (the id the browser's error page shows), where it happened, the method and route
 * template of the request, and its request id when the proxy gave it one.
 *
 * An API route's error that `logRequest` already wrote as `request_failed` is skipped, so it isn't
 * logged twice. The request's headers are never logged: only the proxy's id is read from them.
 */
export function logRequestError(
  err: unknown,
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2],
): void {
  if (context.routeType === "route" && isLoggedRequestFailure(err)) return;

  const pathname = request.path.split(/[?#]/, 1)[0];
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  log.error("server_render_failed", {
    ...errorFields(err),
    digest,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    method: request.method,
    route: routeTemplate(pathname),
    requestId: proxyRequestId(toHeaders(request.headers), pathname) ?? undefined,
  });
}
