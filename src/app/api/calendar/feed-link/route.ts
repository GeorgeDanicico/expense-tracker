import type { CalendarFeedLinkResponse, CreatedCalendarFeedLink } from "@/lib/api/keys";
import { requireFamilyFeature } from "@/lib/family/feature";
import { generateFeedToken } from "@/lib/family-calendar/feed-token";
import { json, noContent, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";

/** Whether the caller has a live feed link, and when it was made and last fetched. Never the secret or its hash. */
export const GET = withUser(async () => {
  requireFamilyFeature();
  const feed = await getRepositories().calendarFeeds.get();
  return json({ feed } satisfies CalendarFeedLinkResponse);
}, { failure: "Unable to load your calendar link." });

/**
 * Makes the caller's feed link, or a new one that stops the old at once: 201 `{ feed, token }`, the
 * only time the secret is ever sent (every `json` response is `no-store`). Only its hash reaches the
 * database. The client builds the `webcal://` link from the token and the origin it was opened on.
 * Never log the body.
 */
export const POST = withUser(async () => {
  requireFamilyFeature();
  const { token, hash } = generateFeedToken();
  const feed = await getRepositories().calendarFeeds.create(hash);
  return json({ feed, token } satisfies CreatedCalendarFeedLink, 201);
}, { failure: "Unable to create your calendar link. Please try again." });

/** Turns the link off (204); already off is fine. */
export const DELETE = withUser(async () => {
  requireFamilyFeature();
  await getRepositories().calendarFeeds.revoke();
  return noContent();
}, { failure: "Unable to turn off your calendar link. Please try again." });
