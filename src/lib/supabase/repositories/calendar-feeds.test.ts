import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAnonClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/anon-client", () => ({ createAnonClient: mocks.createAnonClient }));

import { supabaseCalendarFeedRepository as feeds } from "@/lib/supabase/repositories/calendar-feeds";

const hash = "a".repeat(64);
const feedRow = { id: "f0000000-0000-4000-8000-000000000001", created_at: "2026-10-28T09:00:00Z", last_fetched_at: null };

function useCaller(rows: Record<string, unknown>[], options: FakeSupabaseOptions = {}) {
  const database = fakeSupabase({ calendar_feeds: rows }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

function useAnon(options: FakeSupabaseOptions) {
  const database = fakeSupabase({}, options);
  mocks.createAnonClient.mockReturnValue(database.client);
  return database;
}

const feedEvent = {
  id: "40000000-0000-4000-8000-000000000001", title: "Swimming", notes: "", location: "The pool", allDay: false,
  startsAt: "2026-11-03T07:00:00Z", endsAt: "2026-11-03T08:00:00Z", timezone: "Europe/Bucharest", updatedAt: "2026-10-28T09:00:00Z",
};

describe("Supabase calendar feed repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("get", () => {
    it("returns the caller's live link", async () => {
      const { queries } = useCaller([{ ...feedRow, token_hash: hash, user_id: "u", revoked_at: null }]);

      expect(await feeds.get()).toEqual({ id: feedRow.id, createdAt: feedRow.created_at, lastFetchedAt: null });
      expect(queries[0].filters).toEqual([["is", "revoked_at", null]]);
    });

    it("returns null without a live link", async () => {
      useCaller([{ ...feedRow, revoked_at: "2026-10-29T09:00:00Z" }]);

      expect(await feeds.get()).toBeNull();
    });

    it("keeps database failures private", async () => {
      useCaller([], { fail: () => true });

      await expect(feeds.get()).rejects.toThrow("Unable to load your calendar link.");
    });
  });

  describe("create", () => {
    it("creates the link from the hash and returns it", async () => {
      const { rpcs } = useCaller([], { rpc: () => ({ data: [{ ...feedRow, user_id: "u", revoked_at: null }], error: null }) });

      expect(await feeds.create(hash)).toEqual({ id: feedRow.id, createdAt: feedRow.created_at, lastFetchedAt: null });
      expect(rpcs).toEqual([{ fn: "create_calendar_feed", args: { p_token_hash: hash } }]);
    });

    it("keeps failures private, a malformed hash included, except for no user", async () => {
      useCaller([], { rpc: () => ({ data: null, error: { code: "23514", message: "violates check constraint" } }) });
      await expect(feeds.create("nope")).rejects.toThrow("Unable to create your calendar link. Please try again.");

      useCaller([], { rpc: () => ({ data: null, error: { code: "42501", message: "Sign in to create a calendar link." } }) });
      await expect(feeds.create(hash)).rejects.toMatchObject({ status: 403 });

      useCaller([], { rpc: () => ({ data: [], error: null }) });
      await expect(feeds.create(hash)).rejects.toThrow("Unable to create your calendar link. Please try again.");
    });
  });

  describe("revoke", () => {
    it("says whether there was a link to revoke", async () => {
      const { rpcs } = useCaller([], { rpc: () => ({ data: true, error: null }) });
      expect(await feeds.revoke()).toBe(true);
      expect(rpcs).toEqual([{ fn: "revoke_calendar_feed", args: {} }]);

      useCaller([], { rpc: () => ({ data: false, error: null }) });
      expect(await feeds.revoke()).toBe(false);
    });

    it("keeps database failures private", async () => {
      useCaller([], { rpc: () => ({ data: null, error: { code: "XX000", message: "private" } }) });

      await expect(feeds.revoke()).rejects.toThrow("Unable to turn off your calendar link. Please try again.");
    });
  });

  describe("read", () => {
    it("reads the feed as anon, never as the caller", async () => {
      const { rpcs } = useAnon({ rpc: () => ({ data: { familyName: "The Smiths", events: [feedEvent] }, error: null }) });

      expect(await feeds.read(hash)).toEqual({ familyName: "The Smiths", events: [feedEvent] });
      expect(rpcs).toEqual([{ fn: "calendar_feed", args: { p_token_hash: hash } }]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });

    it("returns null for an unknown or revoked hash, and an empty feed for an owner without a family", async () => {
      useAnon({ rpc: () => ({ data: null, error: null }) });
      expect(await feeds.read(hash)).toBeNull();

      useAnon({ rpc: () => ({ data: { familyName: null, events: [] }, error: null }) });
      expect(await feeds.read(hash)).toEqual({ familyName: null, events: [] });
    });

    it("refuses a malformed answer and keeps database failures private", async () => {
      useAnon({ rpc: () => ({ data: { familyName: "The Smiths", events: [{ id: 1 }] }, error: null }) });
      await expect(feeds.read(hash)).rejects.toThrow("Unable to load the calendar feed.");

      useAnon({ rpc: () => ({ data: "feed", error: null }) });
      await expect(feeds.read(hash)).rejects.toThrow("Unable to load the calendar feed.");

      useAnon({ rpc: () => ({ data: null, error: { code: "XX000", message: "private" } }) });
      await expect(feeds.read(hash)).rejects.toThrow("Unable to load the calendar feed.");
    });
  });
});
