import type { NextRequest } from "next/server";

import { getAuthenticatedUser } from "@/lib/auth";
import { clientKey } from "@/lib/http/client-ip";
import { isAppOrigin } from "@/lib/http/guard";
import {
  CLIENT_LOG_PROCESS_KEY,
  CLIENT_LOG_WINDOW_MS,
  clientLogAttempts,
  clientLogEvents,
  TOO_MANY_CLIENT_REPORTS,
} from "@/lib/http/rate-limit";
import { json, noContent, readJson, tooManyRequests, withRequestGuard } from "@/lib/http/route";
import { errorFields, log } from "@/lib/log";
import { CLIENT_LOG_MAX_BYTES, clientEventLine, clientLogBodySchema, NOT_A_CLIENT_REPORT } from "@/lib/log/client-report";
import { addRequestFields, setRequestUser } from "@/lib/log/request-context";

/**
 * Where the browser sends its errors and Web Vitals (logging plan, L6). Each event in the batch
 * becomes one `client_error` (`warn`) or `web_vital` (`info`) line with `userId` when signed in, the
 * page as a path, the event's checked fields, this request's own `requestId` and the event's
 * `requestId` as `relatedRequestId`. The contract and the sanitising are in
 * `src/lib/log/client-report.ts`.
 *
 * Anyone may send one, signed out included (errors on the sign-in and join pages matter too), but
 * only from the app's own pages: it goes through `withRequestGuard`, so a cross-site write is a 403
 * and every request counts against the per-IP `anonymousRequests` limit. A session, when there is
 * one, only adds the user id; there is never a 401.
 *
 * Answers: 204; 400 with {@link NOT_A_CLIENT_REPORT} and nothing more for any body that isn't a
 * report; 413 past `CLIENT_LOG_MAX_BYTES`; 415 for a body that isn't `application/json`; 429 with
 * `Retry-After` when the client is past `clientLogAttempts` (30 events a minute per user, or per IP
 * signed out, counted per event). The events of a batch that fit under the limit are logged before
 * the 429. Past the process-wide cap (`clientLogEvents`, 600 events a minute) events are dropped
 * without a refusal, and one `client_log_dropped` line a minute says how many.
 *
 * SECURITY: the body is untrusted and partly anonymous. Nothing of it is logged except through
 * `clientEventLine`, and the logger redacts every field again on the way out.
 */
export const POST = withRequestGuard(async (request: NextRequest) => {
  const parsed = clientLogBodySchema.safeParse(await readJson(request, { maxBytes: CLIENT_LOG_MAX_BYTES }));
  if (!parsed.success) return json({ error: NOT_A_CLIENT_REPORT }, 400);

  const userId = await signedInUserId();
  if (userId) setRequestUser(userId);
  const key = userId ? `user:${userId}` : `ip:${clientKey(request)}`;
  if (clientLogAttempts.isLimited(key)) {
    return tooManyRequests(TOO_MANY_CLIENT_REPORTS, clientLogAttempts.retryAfterSeconds(key));
  }

  const appOrigin = (origin: string) => isAppOrigin(origin, request);
  let logged = 0;
  let refused = 0;
  let dropped = 0;
  for (const event of parsed.data.events) {
    if (clientLogAttempts.isLimited(key)) {
      refused += 1;
      continue;
    }
    clientLogAttempts.recordAttempt(key);
    if (clientLogEvents.isLimited(CLIENT_LOG_PROCESS_KEY)) {
      dropped += 1;
      continue;
    }
    clientLogEvents.recordAttempt(CLIENT_LOG_PROCESS_KEY);
    const line = clientEventLine(event, appOrigin);
    log[line.level](line.event, { userId: userId ?? undefined, ...line.fields });
    logged += 1;
  }
  noteDropped(dropped);

  addRequestFields({
    clientEvents: logged,
    clientEventsRefused: refused || undefined,
    clientEventsDropped: dropped || undefined,
  });
  if (refused > 0) return tooManyRequests(TOO_MANY_CLIENT_REPORTS, clientLogAttempts.retryAfterSeconds(key));
  return noContent();
});

/**
 * The signed-in user's id from the session's claims (`getAuthenticatedUser`, read once per request),
 * or null when signed out. A failed check counts as signed out: a report never fails for it.
 */
async function signedInUserId(): Promise<string | null> {
  try {
    return (await getAuthenticatedUser())?.id ?? null;
  } catch (error) {
    log.debug("client_log_user_failed", errorFields(error));
    return null;
  }
}

/** Events dropped by the process-wide cap and not yet counted in a line, and when the last line was written. */
const drops = { pending: 0, lastLineAt: Number.NEGATIVE_INFINITY };

/**
 * Adds `count` dropped events to the tally and, at most once a minute, writes `client_log_dropped`
 * with how many were dropped since the last line. Called on every request, so a tally left over from
 * a flood is written by the next report after the minute is up.
 */
function noteDropped(count: number): void {
  drops.pending += count;
  const now = Date.now();
  if (drops.pending === 0 || now - drops.lastLineAt < CLIENT_LOG_WINDOW_MS) return;
  log.warn("client_log_dropped", { dropped: drops.pending });
  drops.pending = 0;
  drops.lastLineAt = now;
}
