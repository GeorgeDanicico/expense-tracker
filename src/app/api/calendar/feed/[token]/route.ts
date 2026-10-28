import { toICalendar } from "@/lib/family-calendar/ics";
import { hashFeedToken, parseFeedToken } from "@/lib/family-calendar/feed-token";
import { getRepositories } from "@/lib/repositories";

// node:crypto (the token's hash) needs the Node runtime.
export const runtime = "nodejs";

/** What an unknown, revoked or malformed link answers: a bare 404, nothing that says which. */
function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

/**
 * A member's calendar feed (`/api/calendar/feed/<token>.ics`), fetched by a calendar app that has no
 * session: the secret in the path is the only credential, so this route never reads a cookie, never
 * asks who is signed in, and is left out of `src/proxy.ts`'s matcher. The token is hashed here and
 * the database function, which only returns the token owner's own events, does the rest. 404 for a
 * malformed, unknown or revoked token; an empty calendar once the owner has left their family.
 * Not behind `requireFamilyFeature()`: a link that exists keeps working, and the data is gated by
 * what the database holds.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = parseFeedToken((await params).token);
  if (!token) return notFound();

  let feed;
  try {
    feed = await getRepositories().calendarFeeds.read(hashFeedToken(token));
  } catch {
    // A database failure is not "no such link": the app keeps its subscription and retries.
    return new Response(null, { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0", "Retry-After": "60" } });
  }
  if (!feed) return notFound();

  return new Response(toICalendar({ ...feed, now: new Date() }), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // Private: the link is the credential, so shared caches must not keep it. Five minutes, well
      // inside the 15-minute refresh hint.
      "Cache-Control": "private, max-age=300",
    },
  });
}
