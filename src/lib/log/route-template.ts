import { redactPath } from "@/lib/log/redact-path";

/**
 * The route template a request line names (logging plan, L2). Next doesn't tell a route handler its
 * own pattern, so it's built from the path: `/api/expenses/6c3f…` becomes `/api/expenses/:id`.
 *
 * SECURITY: the template lands in every request line, so nothing that identifies a record beyond a
 * UUID's place, and nothing secret, may survive it. A new dynamic route whose segment isn't a UUID
 * and could be short needs a rule in {@link PARAM_ROUTES}; `route-template.test.ts` fails until it has one.
 */

/** Routes whose dynamic segment is short and not a UUID, so the generic rules below can't spot it. */
const PARAM_ROUTES: readonly [RegExp, string][] = [
  [/^\/api\/calendar\/feed\/[^/]+/, "/api/calendar/feed/:token"],
  [/^\/api\/oauth\/authorizations\/[^/]+/, "/api/oauth/authorizations/:id"],
  [/^\/api\/account\/mcp\/apps\/[^/]+/, "/api/account/mcp/apps/:clientId"],
];

/** The placeholders the rules above put in, which the per-segment rules leave alone. */
const PLACEHOLDERS: ReadonlySet<string> = new Set([":token", ":id", ":clientId", ":code"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A segment longer than this is a value, not a name. */
const MAX_NAME_LENGTH = 24;
/** A segment of at least this many letters and digits, with both in it, is a value too (a short hash or token). */
const MIXED_MIN_LENGTH = 16;

function isValueSegment(segment: string): boolean {
  if (segment.length > MAX_NAME_LENGTH) return true;
  return segment.length >= MIXED_MIN_LENGTH && /^[A-Za-z0-9]+$/.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment);
}

/**
 * The template of `path` (a pathname; a query string or fragment is dropped): UUID segments become
 * `:id`, the calendar feed's token `:token`, an invite link's code `:code` (`redactPath`), the two
 * OAuth ids `:id` and `:clientId`, and any other segment longer than 24 characters, or of 16 or more
 * letters and digits mixed, `:value`.
 */
export function routeTemplate(path: string): string {
  let template = redactPath(path.split(/[?#]/, 1)[0]);
  for (const [pattern, replacement] of PARAM_ROUTES) {
    if (pattern.test(template)) {
      template = template.replace(pattern, replacement);
      break;
    }
  }
  return template
    .split("/")
    .map((segment) => {
      if (PLACEHOLDERS.has(segment)) return segment;
      if (UUID.test(segment)) return ":id";
      return isValueSegment(segment) ? ":value" : segment;
    })
    .join("/");
}
