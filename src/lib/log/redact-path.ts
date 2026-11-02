/**
 * Paths with secret segments, made safe to log. Shared by the CSP reports (`src/lib/http/csp-report.ts`),
 * the request line's route template (`route-template.ts`) and, later, the browser's reports.
 */

/** Paths whose segments are secrets, with what they're logged as. */
const SECRET_PATHS: readonly [RegExp, string][] = [
  [/^\/join\/[^/]+/, "/join/:code"], // An invite link's code.
];

/** `path` with any secret segment replaced (an invite code in `/join/<code>`). */
export function redactPath(path: string): string {
  for (const [pattern, replacement] of SECRET_PATHS) {
    if (pattern.test(path)) return path.replace(pattern, replacement);
  }
  return path;
}
