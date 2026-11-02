import { loggablePagePath, loggableResourcePath } from "@/lib/log/loggable-path";
import { redactString } from "@/lib/log/redact";

/**
 * Reading the CSP violation reports browsers send to `POST /api/csp-report` (security plan S7),
 * down to the few fields worth a log line. Two formats arrive:
 * - `application/csp-report` (the `report-uri` directive; Firefox and Safari):
 *   `{ "csp-report": { "document-uri", "effective-directive", "blocked-uri", … } }`.
 * - `application/reports+json` (the Reporting API's `report-to`; Chromium): an array of
 *   `{ type: "csp-violation", url, body: { documentURL, effectiveDirective, blockedURL, … } }`,
 *   possibly batched with other report types, which are skipped.
 *
 * SECURITY: a report is written by whoever sends it and lands in the logs, so only short, checked
 * values are kept. URLs lose their query string and fragment (they can hold tokens or invite
 * codes); the document is logged as a path only, through `loggablePagePath` (ids as in the request
 * line's route template, an invite link's code replaced); same-origin resources as paths and other
 * origins as origin plus path, through `loggableResourcePath`; `data:` and `blob:` as just the
 * scheme. Every path segment that holds a secret is `[redacted]`. The paths go through the same
 * helpers (`src/lib/log/loggable-path.ts`) as the browser's own reports (`POST /api/client-log`),
 * so the two stay in line. The `sample` (the start of the blocked code) and anything else in the
 * report are dropped.
 */

/** The content types the endpoint accepts, by the format each one means. */
export const CSP_REPORT_CONTENT_TYPES = {
  "application/csp-report": "csp-report",
  "application/reports+json": "reports+json",
} as const;

export type CspReportFormat = (typeof CSP_REPORT_CONTENT_TYPES)[keyof typeof CSP_REPORT_CONTENT_TYPES];

/** What the endpoint answers, with status 415, to any other content type. */
export const NOT_A_CSP_REPORT_TYPE = "Send a CSP report (application/csp-report or application/reports+json).";
/** What the endpoint answers, with status 400, to a body that isn't a report. */
export const NOT_A_CSP_REPORT = "That isn't a CSP report.";

/** The largest report body read. A Reporting API batch of a broken page fits easily. */
export const CSP_REPORT_MAX_BYTES = 32 * 1024;

/** The most violations logged from one request; the rest of a batch is dropped. */
export const CSP_REPORT_MAX_VIOLATIONS = 20;

/** The most characters kept of any one value. */
const MAX_VALUE_LENGTH = 200;

/** One violation, as logged. Fields the report didn't have (or had in a bad shape) are left out. */
export type CspViolation = {
  directive: string;
  blocked?: string;
  document?: string;
  source?: string;
  line?: number;
  column?: number;
  disposition?: "enforce" | "report";
};

/** The format for a `Content-Type`, ignoring parameters such as `charset`, or null for any other type. */
export function cspReportFormat(contentType: string | null): CspReportFormat | null {
  const type = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  return Object.hasOwn(CSP_REPORT_CONTENT_TYPES, type)
    ? CSP_REPORT_CONTENT_TYPES[type as keyof typeof CSP_REPORT_CONTENT_TYPES]
    : null;
}

/**
 * The violations in a report body, or null when it isn't a report in `format` at all (not JSON, or
 * the wrong shape). A Reporting API batch with no CSP violations in it is an empty list.
 */
export function parseCspReport(format: CspReportFormat, body: Uint8Array): CspViolation[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }

  if (format === "csp-report") {
    if (!isRecord(parsed) || !isRecord(parsed["csp-report"])) return null;
    const report = parsed["csp-report"];
    const violation = toViolation({
      directive: report["effective-directive"] ?? firstWord(report["violated-directive"]),
      document: report["document-uri"],
      blocked: report["blocked-uri"],
      source: report["source-file"],
      line: report["line-number"],
      column: report["column-number"],
      disposition: report.disposition,
    });
    return violation ? [violation] : null;
  }

  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((report): report is Record<string, unknown> => isRecord(report) && report.type === "csp-violation" && isRecord(report.body))
    .slice(0, CSP_REPORT_MAX_VIOLATIONS)
    .flatMap((report) => {
      const body = report.body as Record<string, unknown>;
      const violation = toViolation({
        directive: body.effectiveDirective,
        document: body.documentURL ?? report.url,
        blocked: body.blockedURL,
        source: body.sourceFile,
        line: body.lineNumber,
        column: body.columnNumber,
        disposition: body.disposition,
      });
      return violation ? [violation] : [];
    });
}

type RawViolation = Record<"directive" | "document" | "blocked" | "source" | "line" | "column" | "disposition", unknown>;

/** The checked violation, or null without a directive (nothing to act on). */
function toViolation(raw: RawViolation): CspViolation | null {
  const directive = typeof raw.directive === "string" && /^[a-z-]{1,40}$/.test(raw.directive) ? raw.directive : null;
  if (!directive) return null;

  const documentUrl = parseUrl(raw.document);
  const violation: CspViolation = { directive };
  if (documentUrl) violation.document = loggablePagePath(documentUrl.pathname);
  const blocked = describeResource(raw.blocked, documentUrl);
  if (blocked) violation.blocked = blocked;
  const source = describeResource(raw.source, documentUrl);
  if (source) violation.source = source;
  const line = lineOrColumn(raw.line);
  if (line !== undefined) violation.line = line;
  const column = lineOrColumn(raw.column);
  if (column !== undefined) violation.column = column;
  if (raw.disposition === "enforce" || raw.disposition === "report") violation.disposition = raw.disposition;
  return violation;
}

/**
 * A blocked resource or script file without query or fragment: a path when it's the document's own
 * origin, origin and path otherwise, the scheme alone for `data:`, `blob:` and the like, and a
 * keyword (`inline`, `eval`, `wasm-eval`, `trusted-types-policy`…) as is.
 */
function describeResource(value: unknown, documentUrl: URL | null): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const url = parseUrl(value);
  if (!url) return /^[a-z-]{1,40}$/.test(value) ? value : undefined;
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return url.protocol.slice(0, -1);
  if (documentUrl && url.origin === documentUrl.origin) return loggableResourcePath(url.pathname);
  return clip(`${redactString(url.origin)}${loggableResourcePath(url.pathname)}`);
}

function parseUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function lineOrColumn(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 10_000_000 ? value : undefined;
}

function firstWord(value: unknown): unknown {
  return typeof value === "string" ? value.trim().split(/\s+/)[0] : value;
}

function clip(value: string): string {
  return value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
