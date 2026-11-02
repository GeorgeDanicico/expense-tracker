import { currentRequest, type RequestContext, type Span, type SpanTotals } from "@/lib/log/request-context";

/**
 * Spans (logging plan, L4): timed calls inside a request, listed in its `request` line as
 * `spans: [{ name: "db.expenses.get", ms: 12 }, …]`. This is the whole of the app's tracing: no
 * backend, just the request's own line. Every Supabase call gets one through `traced-fetch.ts`;
 * Web Push sends, AI calls and the PDF parse call {@link span} themselves.
 *
 * Outside a request context (the proxy, a script, the worker until it opens one per tick) nothing is
 * recorded and the call just runs. Recording never throws and never changes what the call returns or
 * throws.
 *
 * It imports nothing from `next/*` or `server-only`, so the worker can use it.
 */

/** The most entries a request's span list holds. */
export const MAX_SPANS = 30;
/** The entry that collects calls past {@link MAX_SPANS} distinct names. */
export const OTHER_SPAN = "other";

/** The fields a caller may add to its span. */
export type SpanFields = Pick<Span, "deviceId" | "status" | "error">;

/** Prefixes of the spans counted in the request line's `dbMs` and `dbCalls`. */
const DB_PREFIXES = ["db.", "rpc.", "auth.", "storage."] as const;

/** Whether a span of this name is a Supabase call, counted in `dbMs` and `dbCalls`. */
export function isDbSpan(name: string): boolean {
  return DB_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** A run of letters, digits, `_` and `-` long enough for the logger to redact it as a secret (`redact.ts`: 32 or more). */
const REDACTED_RUN = /[A-Za-z0-9_-]{31,}/g;
/** What a name part may hold; anything else becomes `_`. */
const UNSAFE = /[^A-Za-z0-9_.:-]/g;
const MAX_PART_LENGTH = 80;

/**
 * `text` made fit for a span name: characters other than letters, digits, `_`, `.`, `:` and `-`
 * replaced by `_`, and any run of 31 or more letters, digits, `_` and `-` clipped to 30 and an
 * ellipsis. The clipping matters: the logger redacts a run of 32 or more as a secret, which would
 * turn `rpc.create_net_worth_item_with_valuation` into `rpc.[redacted]`.
 */
export function spanNamePart(text: string): string {
  return text
    .slice(0, MAX_PART_LENGTH)
    .replace(UNSAFE, "_")
    .replace(REDACTED_RUN, (run) => `${run.slice(0, 30)}…`);
}

function totalsOf(context: RequestContext): SpanTotals {
  return (context.spanTotals ??= { dbMs: 0, dbCalls: 0 });
}

/** `entry` with `span` added to it: ms summed, `count` raised, `error` kept if either failed, other fields dropped. */
function merged(entry: Span, span: Span): Span {
  const result: Span = { name: entry.name, ms: entry.ms + span.ms, count: (entry.count ?? 1) + (span.count ?? 1) };
  if (entry.error || span.error) result.error = true;
  return result;
}

/** Merges the entries of `spans` that share a name into the first of them, in place, keeping the order. */
function mergeSameNames(spans: Span[]): void {
  const firstByName = new Map<string, number>();
  const kept: Span[] = [];
  for (const span of spans) {
    const index = firstByName.get(span.name);
    if (index === undefined) {
      firstByName.set(span.name, kept.length);
      kept.push(span);
    } else {
      kept[index] = merged(kept[index], span);
    }
  }
  spans.splice(0, spans.length, ...kept);
}

/**
 * Adds `span` to `spans`, holding the list to {@link MAX_SPANS} entries. Until the list first fills
 * up each call is its own entry. From then on, entries of one name are merged into
 * `{ name, ms, count }` (ms summed), and once there are 30 distinct names a call whose name isn't in
 * the list goes into one `{ name: "other", ms, count }` entry, which takes the last place.
 */
function addSpan(spans: Span[], span: Span, totals: SpanTotals): void {
  if (!totals.merging) {
    if (spans.length < MAX_SPANS) {
      spans.push(span);
      return;
    }
    mergeSameNames(spans);
    totals.merging = true;
  }
  const same = spans.findIndex((entry) => entry.name === span.name);
  if (same !== -1) {
    spans[same] = merged(spans[same], span);
    return;
  }
  if (spans.length < MAX_SPANS) {
    spans.push(span);
    return;
  }
  const other = spans.findIndex((entry) => entry.name === OTHER_SPAN);
  if (other !== -1) {
    spans[other] = merged(spans[other], span);
    return;
  }
  // No room and no `other` yet: the last entry becomes `other`, with this call in it.
  const last = spans.pop()!;
  spans.push(merged({ ...last, name: OTHER_SPAN }, span));
}

/**
 * Records a call of `name` that took `ms` on `context` (default: the current request): in the span
 * list, with `ms` rounded to whole milliseconds, and in the totals the request line reads. Does
 * nothing outside a request, and never throws.
 */
export function recordSpan(name: string, ms: number, fields: SpanFields = {}, context: RequestContext | undefined = currentRequest()): void {
  if (!context) return;
  try {
    const elapsed = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const entry: Span = { name, ms: Math.round(elapsed) };
    if (fields.error) entry.error = true;
    if (fields.status !== undefined) entry.status = fields.status;
    if (fields.deviceId !== undefined) entry.deviceId = fields.deviceId;
    const totals = totalsOf(context);
    addSpan(context.spans, entry, totals);

    if (isDbSpan(name)) {
      totals.dbMs += elapsed;
      totals.dbCalls += 1;
    }
    if (!totals.slowest || elapsed > totals.slowest.ms) totals.slowest = { name, ms: elapsed };
  } catch {
    // Logging never breaks a call.
  }
}

/**
 * Runs `fn` as a span of `name` in the current request: records `{ name, ms }` when it settles
 * (with `error: true` when it throws) and returns its result or rethrows its error unchanged.
 * Outside a request it just runs `fn`. `fields` are added to the span (`deviceId`).
 */
export async function span<T>(name: string, fn: () => T | Promise<T>, fields?: SpanFields): Promise<T> {
  const context = currentRequest();
  if (!context) return fn();
  const startedAt = performance.now();
  try {
    const result = await fn();
    recordSpan(name, performance.now() - startedAt, fields, context);
    return result;
  } catch (error) {
    recordSpan(name, performance.now() - startedAt, { ...fields, error: true }, context);
    throw error;
  }
}

/** The request line's span fields: `dbMs` and `dbCalls`, and `slowestSpan` when the request was slow. */
export function spanSummary(context: RequestContext, slow: boolean): { dbMs: number; dbCalls: number; slowestSpan?: { name: string; ms: number } } {
  const totals = context.spanTotals;
  const summary: { dbMs: number; dbCalls: number; slowestSpan?: { name: string; ms: number } } = {
    dbMs: Math.round(totals?.dbMs ?? 0),
    dbCalls: totals?.dbCalls ?? 0,
  };
  if (slow && totals?.slowest) summary.slowestSpan = { name: totals.slowest.name, ms: Math.round(totals.slowest.ms) };
  return summary;
}
