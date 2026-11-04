/**
 * Home used to hold the Summary, Monthly and History dashboards, chosen by query parameters
 * (`/dashboard?view=monthly&month=2026-09`, `?period=1y`, `?member=…`). They moved to Money →
 * Insights at `/insights`, and Home is "today". A `/dashboard` URL that carries one of those
 * parameters is an old bookmark or link, so it goes to `/insights` with its query kept (Next passes
 * the query through a redirect); a plain `/dashboard` is Home. No imports: `next.config.ts` loads it.
 */
export const LEGACY_DASHBOARD_PARAMS = ["view", "month", "period", "granularity", "date", "member"] as const;

type Redirect = { source: string; has: { type: "query"; key: string }[]; destination: string; permanent: false };

/** One redirect per parameter, since a redirect's `has` items must all match. */
export function legacyRedirects(): Redirect[] {
  return LEGACY_DASHBOARD_PARAMS.map((key) => ({
    source: "/dashboard",
    has: [{ type: "query", key }],
    destination: "/insights",
    permanent: false,
  }));
}
