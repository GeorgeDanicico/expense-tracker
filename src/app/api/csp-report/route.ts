import type { NextRequest } from "next/server";

import { readBodyWithLimit } from "@/lib/http/body";
import { clientIp } from "@/lib/http/client-ip";
import {
  CSP_REPORT_MAX_BYTES,
  cspReportFormat,
  NOT_A_CSP_REPORT,
  NOT_A_CSP_REPORT_TYPE,
  parseCspReport,
} from "@/lib/http/csp-report";
import { HttpError } from "@/lib/http/errors";
import { cspReportAttempts, TOO_MANY_CSP_REPORTS } from "@/lib/http/rate-limit";
import { BODY_TOO_LARGE, json, noContent, tooManyRequests } from "@/lib/http/route";

/**
 * Where browsers send Content Security Policy violations (security plan S7): the policy's
 * `report-uri` and `report-to` both point here. Logs one JSON line per violation (`csp_violation`:
 * directive, blocked resource, document path; see `src/lib/http/csp-report.ts` for what is kept and
 * what is stripped) and answers 204.
 *
 * Public on purpose: it never reads cookies or the session (the proxy skips it too), and changes
 * nothing but the logs, so it is exempt from the request guard (`REQUEST_GUARD_EXEMPTIONS`).
 * Instead every request counts against a per-IP limit (429 past it), the body is limited to
 * `CSP_REPORT_MAX_BYTES` (413), and only the two report content types are read (415).
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request) ?? "unknown";
  if (cspReportAttempts.isLimited(ip)) {
    return tooManyRequests(TOO_MANY_CSP_REPORTS, cspReportAttempts.retryAfterSeconds(ip));
  }
  cspReportAttempts.recordAttempt(ip);

  const format = cspReportFormat(request.headers.get("content-type"));
  if (!format) return json({ error: NOT_A_CSP_REPORT_TYPE }, 415);

  let body: Uint8Array;
  try {
    body = await readBodyWithLimit(request, CSP_REPORT_MAX_BYTES, BODY_TOO_LARGE);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }

  const violations = parseCspReport(format, body);
  if (!violations) return json({ error: NOT_A_CSP_REPORT }, 400);

  for (const violation of violations) {
    console.warn(JSON.stringify({ event: "csp_violation", ...violation }));
  }
  return noContent();
}
