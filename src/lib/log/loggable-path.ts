import { REDACTED, redactString } from "@/lib/log/redact";
import { redactPath } from "@/lib/log/redact-path";
import { routeTemplate } from "@/lib/log/route-template";

/**
 * Paths from untrusted reports, made safe to log (logging plan, L6). The CSP reports
 * (`src/lib/http/csp-report.ts`) and the browser's error and Web Vitals reports
 * (`src/lib/log/client-report.ts`) both go through these, so the two stay in line.
 *
 * SECURITY: a report's URLs are written by whoever sends it. Both functions drop the query string
 * and fragment (they can hold tokens or invite codes), replace an invite link's code
 * (`redactPath`), and replace any segment that holds a secret, as sent or percent-decoded (an email
 * address, a JWT, a Supabase key, a long token), with `[redacted]`. The result is at most
 * {@link MAX_PATH_LENGTH} characters.
 */

/** The most characters kept of a logged path. */
export const MAX_PATH_LENGTH = 200;

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** `segment` as it is, or `[redacted]` when it holds a secret, as sent or percent-decoded. */
function redactSegment(segment: string): string {
  if (redactString(segment) !== segment) return REDACTED;
  const decoded = safeDecode(segment);
  return redactString(decoded) === decoded ? segment : REDACTED;
}

function clean(path: string): string {
  const cleaned = path.split("/").map(redactSegment).join("/");
  return cleaned.length > MAX_PATH_LENGTH ? cleaned.slice(0, MAX_PATH_LENGTH) : cleaned;
}

/** The path part of `path` (a pathname, possibly with a query string or fragment). */
function withoutQuery(path: string): string {
  return path.split(/[?#]/, 1)[0];
}

/**
 * A page's path as logged: like the request line's route template (`routeTemplate`), so UUIDs become
 * `:id`, an invite code `:code` and other long or token-like segments `:value`, then with any
 * remaining secret segment `[redacted]`. `/expenses/6c3f…?month=11` becomes `/expenses/:id`.
 */
export function loggablePagePath(path: string): string {
  return clean(routeTemplate(withoutQuery(path)));
}

/**
 * A script or other resource's path as logged: kept as it is (a chunk's hashed name is what matches
 * it to a build), but without query or fragment, with an invite code replaced and any secret
 * segment `[redacted]`.
 */
export function loggableResourcePath(path: string): string {
  return clean(redactPath(withoutQuery(path)));
}
