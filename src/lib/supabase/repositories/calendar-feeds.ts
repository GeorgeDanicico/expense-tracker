import "server-only";

import {
  type CalendarFeed,
  type CalendarFeedData,
  type CalendarFeedEvent,
  type CalendarFeedRepository,
} from "@/lib/family-calendar/feed-repository";
import { createAnonClient } from "@/lib/supabase/anon-client";
import { translateDatabaseError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

const LOAD_ERROR = "Unable to load your calendar link.";
const SAVE_ERROR = "Unable to create your calendar link. Please try again.";
const REVOKE_ERROR = "Unable to turn off your calendar link. Please try again.";
const FEED_ERROR = "Unable to load the calendar feed.";

// Never `token_hash`: signed-in users aren't granted it.
const FEED_COLUMNS = "id, created_at, last_fetched_at";

type FeedRow = { id: string; created_at: string; last_fetched_at: string | null };

function toFeed(row: FeedRow): CalendarFeed {
  return { id: row.id, createdAt: row.created_at, lastFetchedAt: row.last_fetched_at };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toFeedEvent(value: unknown): CalendarFeedEvent {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.notes !== "string"
    || typeof value.location !== "string"
    || typeof value.allDay !== "boolean"
    || typeof value.startsAt !== "string"
    || typeof value.endsAt !== "string"
    || typeof value.timezone !== "string"
    || typeof value.updatedAt !== "string"
  ) {
    throw new Error(FEED_ERROR);
  }
  return {
    id: value.id,
    title: value.title,
    notes: value.notes,
    location: value.location,
    allDay: value.allDay,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    timezone: value.timezone,
    updatedAt: value.updatedAt,
  };
}

/**
 * `CalendarFeedRepository` on `calendar_feeds` and the feed functions
 * (supabase/migrations/20261028000100_create_family_calendar.sql). `get`, `create` and `revoke` act
 * as the request's caller, under RLS; `read` is the `anon` role calling `calendar_feed()`, which
 * returns only the token owner's own events.
 */
export const supabaseCalendarFeedRepository: CalendarFeedRepository = {
  async get() {
    const supabase = await createClient();
    const { data, error } = await supabase.from("calendar_feeds").select(FEED_COLUMNS)
      .is("revoked_at", null).maybeSingle();
    if (error) throw new Error(LOAD_ERROR);
    return data ? toFeed(data) : null;
  },

  async create(tokenHash) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_calendar_feed", { p_token_hash: tokenHash });
    // A 23514 is a hash that isn't 64 hex characters: the server made it, so that is our bug.
    if (error) throw error.code === "23514" ? new Error(SAVE_ERROR) : translateDatabaseError(error, SAVE_ERROR);
    const row = data[0];
    if (!row) throw new Error(SAVE_ERROR);
    return toFeed(row);
  },

  async revoke() {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("revoke_calendar_feed");
    if (error) throw translateDatabaseError(error, REVOKE_ERROR);
    return data;
  },

  async read(tokenHash): Promise<CalendarFeedData | null> {
    const { data, error } = await createAnonClient().rpc("calendar_feed", { p_token_hash: tokenHash });
    if (error) throw new Error(FEED_ERROR);
    if (data === null) return null;
    if (!isRecord(data) || !Array.isArray(data.events) || (data.familyName !== null && typeof data.familyName !== "string")) {
      throw new Error(FEED_ERROR);
    }
    return { familyName: data.familyName, events: data.events.map(toFeedEvent) };
  },
};
