/** The caller's live calendar feed link; its secret is never stored, only shown once when it's made. */
export type CalendarFeed = {
  id: string;
  createdAt: string;
  /** When a calendar app last fetched the feed, to within 5 minutes; null if never. */
  lastFetchedAt: string | null;
};

/** One event of a feed, as `calendar_feed()` returns it. Instants are UTC ISO strings. */
export type CalendarFeedEvent = {
  id: string;
  title: string;
  notes: string;
  location: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  /** IANA time zone, to read an all-day event's dates. */
  timezone: string;
  updatedAt: string;
};

/**
 * What a feed holds: the family's name (null once the owner left their family, when `events` is
 * empty too) and only the events the link's owner attends that ended at most 90 days ago, by start.
 */
export type CalendarFeedData = {
  familyName: string | null;
  events: CalendarFeedEvent[];
};

/**
 * The signed-in user's private iCalendar link, and the read the feed route makes. Get it from
 * `getRepositories().calendarFeeds`; never import an implementation. `get`, `create` and `revoke`
 * act as the caller; `read` has no caller and is the only method for the route.
 */
export interface CalendarFeedRepository {
  /** The caller's live link, or null when they have none (never made, or revoked). */
  get(): Promise<CalendarFeed | null>;
  /**
   * Makes the caller's link from `tokenHash` (the lowercase hex SHA-256 of the secret the server
   * made), revoking the live one first, so a user has at most one.
   */
  create(tokenHash: string): Promise<CalendarFeed>;
  /** Revokes the caller's live link, returning false when they had none. */
  revoke(): Promise<boolean>;
  /**
   * The feed for `tokenHash`, read as `anon` (a calendar app has no session), or null for an
   * unknown or revoked hash.
   */
  read(tokenHash: string): Promise<CalendarFeedData | null>;
}
