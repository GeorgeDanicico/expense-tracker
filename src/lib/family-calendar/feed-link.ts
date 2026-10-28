/** Where a calendar app fetches a feed: `/api/calendar/feed/<token>.ics` on the app's own origin. */
export function feedPath(token: string) {
  return `/api/calendar/feed/${token}.ics`;
}

/**
 * The `webcal://` link for a feed secret, on the origin the page was opened from (`https://host`,
 * `http://host:3000`): that is the address the person's devices already reach the app at. Calendar
 * apps read `webcal://` as "subscribe to this", and fetch it over https or http as the host answers.
 */
export function feedWebcalUrl(origin: string, token: string) {
  return `webcal://${origin.replace(/^https?:\/\//, "")}${feedPath(token)}`;
}
