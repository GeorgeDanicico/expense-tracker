import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { ATTENDEE_OUTSIDE_FAMILY_MESSAGE, EVENT_GONE_MESSAGE, NO_FAMILY_MESSAGE } from "@/lib/family-calendar/repository";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseCalendarRepository as calendar, translateCalendarWriteError } from "@/lib/supabase/repositories/calendar";

const familyId = "70000000-0000-4000-8000-000000000201";
const userId = "10000000-0000-4000-8000-000000000201";
const kidUserId = "10000000-0000-4000-8000-000000000202";
const momId = "60000000-0000-4000-8000-000000000201";
const kidId = "60000000-0000-4000-8000-000000000202";
const avatarFile = "90000000-0000-4000-8000-000000000202";

const familyJson = {
  family: { id: familyId, name: "The Smiths", createdAt: "2026-10-01T09:00:00Z" },
  members: [
    {
      memberId: momId, userId, role: "parent", isCreator: true,
      displayName: "Mum", username: null, currency: "EUR", color: null, avatarPath: null, joinedAt: "2026-10-01T09:00:00Z",
    },
    {
      memberId: kidId, userId: kidUserId, role: "kid", isCreator: false,
      displayName: "Ana", username: "ana", currency: "EUR", color: 3, avatarPath: `${kidUserId}/${avatarFile}.webp`,
      joinedAt: "2026-10-02T09:00:00Z",
    },
  ],
};

const ana = { memberId: kidId, name: "Ana", color: 3, avatarUrl: `/api/avatars/${kidUserId}/${avatarFile}` };
const mum = { memberId: momId, name: "Mum", color: null, avatarUrl: null };

let nextId = 1;
const uuid = (prefix: number) => `${prefix}0000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;

/** A `calendar_events` row as PostgREST returns it (Postgres writes instants as `+00:00`), with its embedded attendees. */
function aRow(overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(4),
    series_id: uuid(5),
    series_index: 1,
    series_repeat: "none",
    title: "Swimming",
    notes: "",
    location: "",
    all_day: false,
    starts_at: "2026-11-03T07:00:00+00:00",
    ends_at: "2026-11-03T08:00:00+00:00",
    timezone: "Europe/Bucharest",
    created_by: userId,
    created_at: "2026-10-28T09:00:00+00:00",
    updated_at: "2026-10-28T09:00:00.123456+00:00",
    calendar_event_attendees: [{ member_id: momId }],
    ...overrides,
  };
}

/** `calendar_events` rows behind RLS (the caller's family only), get_family answering `family` (null: no family), and the save functions. */
function useDatabase(
  rows: Record<string, unknown>[],
  options: FakeSupabaseOptions & { family?: unknown } = {},
) {
  const { family = familyJson, rpc, ...rest } = options;
  const database = fakeSupabase({ calendar_events: rows }, {
    rpc: (fn, args) => (fn === "get_family" ? { data: family, error: null } : (rpc?.(fn, args) ?? { data: null, error: null })),
    ...rest,
  });
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

describe("Supabase calendar repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    nextId = 1;
  });

  describe("listBetween", () => {
    it("reads the events overlapping the range by start, with attendees from one get_family and series lengths counted", async () => {
      const seriesId = uuid(5);
      const second = aRow({ series_id: seriesId, series_index: 2, series_repeat: "weekly", starts_at: "2026-11-10T07:00:00+00:00", ends_at: "2026-11-10T08:00:00+00:00" });
      const first = aRow({
        series_id: seriesId, series_index: 1, series_repeat: "weekly",
        calendar_event_attendees: [{ member_id: kidId }, { member_id: momId }],
      });
      const oneOff = aRow({ starts_at: "2026-11-04T07:00:00+00:00", ends_at: "2026-11-04T08:00:00+00:00" });
      const outside = aRow({ starts_at: "2026-12-04T07:00:00+00:00", ends_at: "2026-12-04T08:00:00+00:00" });
      // The third occurrence is outside the listed range, but counts toward the series' length.
      const third = aRow({ series_id: seriesId, series_index: 3, series_repeat: "weekly", starts_at: "2026-11-17T07:00:00+00:00", ends_at: "2026-11-17T08:00:00+00:00" });
      const { rpcs, queries } = useDatabase([second, outside, oneOff, first, third]);

      const listed = await calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z");

      expect(listed.map((event) => event.id)).toEqual([first.id, oneOff.id, second.id]);
      expect(listed[0]).toMatchObject({
        seriesId, seriesIndex: 1, seriesLength: 3, seriesRepeat: "weekly",
        title: "Swimming", allDay: false, timezone: "Europe/Bucharest", createdBy: userId,
        // Postgres' offset and microseconds come back as plain ISO strings.
        startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z",
        createdAt: "2026-10-28T09:00:00.000Z", updatedAt: "2026-10-28T09:00:00.123Z",
        // In the family's order, with the display fields joined.
        attendees: [mum, ana],
      });
      expect(listed[1]).toMatchObject({ seriesLength: 1, seriesRepeat: "none", attendees: [mum] });
      expect(rpcs).toEqual([{ fn: "get_family", args: {} }]);
      expect(queries[0].filters).toEqual([["lt", "starts_at", "2026-11-12T00:00:00.000Z"], ["gt", "ends_at", "2026-11-01T00:00:00.000Z"]]);
      expect(queries[0].orders).toEqual(["starts_at", "id"]);
      // One query for the range and one counting the only repeating series.
      expect(queries).toHaveLength(2);
      expect(queries[1].filters).toEqual([["in", "series_id", [seriesId]]]);
    });

    it("counts no series when every event is a one-off", async () => {
      const { queries } = useDatabase([aRow()]);

      await calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z");

      expect(queries).toHaveLength(1);
    });

    it("counts series in chunks of 50", async () => {
      const rows = Array.from({ length: 120 }, (_, index) => aRow({
        series_repeat: "daily", starts_at: `2026-11-03T07:00:${String(index % 60).padStart(2, "0")}+00:00`,
      }));
      const { queries } = useDatabase(rows);

      const listed = await calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z");

      expect(listed).toHaveLength(120);
      expect(queries.slice(1).map((query) => (query.filters[0][2] as string[]).length)).toEqual([50, 50, 20]);
      expect(listed.every((event) => event.seriesLength === 1)).toBe(true);
    });

    it("refuses a caller without a family with a 404", async () => {
      useDatabase([], { family: null });

      await expect(calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z")).rejects.toMatchObject({
        status: 404, message: NO_FAMILY_MESSAGE,
      });
    });

    it("keeps database failures private", async () => {
      useDatabase([], { fail: () => true });

      await expect(calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z")).rejects.toThrow("Unable to load the calendar.");
    });

    it("refuses a row with an unknown repeat", async () => {
      useDatabase([aRow({ series_repeat: "monthly" })]);

      await expect(calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-11-12T00:00:00.000Z")).rejects.toThrow("Unable to load the calendar.");
    });
  });

  describe("get", () => {
    it("returns the event with its attendees and series length, or null when RLS hides it", async () => {
      const seriesId = uuid(5);
      const row = aRow({ series_id: seriesId, series_repeat: "daily", calendar_event_attendees: [{ member_id: kidId }] });
      useDatabase([row, aRow({ series_id: seriesId, series_index: 2, series_repeat: "daily" })]);

      expect(await calendar.get(row.id)).toMatchObject({ id: row.id, seriesLength: 2, attendees: [ana] });
      expect(await calendar.get("40000000-0000-4000-8000-000000000999")).toBeNull();
    });

    it("keeps database failures private", async () => {
      useDatabase([], { fail: () => true });

      await expect(calendar.get("40000000-0000-4000-8000-000000000999")).rejects.toThrow("Unable to load the calendar.");
    });
  });

  describe("listSeries", () => {
    it("returns the series by index, each with the series' length", async () => {
      const seriesId = uuid(5);
      const rows = [3, 1, 2].map((index) => aRow({ series_id: seriesId, series_index: index, series_repeat: "weekly" }));
      const { queries } = useDatabase([...rows, aRow()]);

      const series = await calendar.listSeries(seriesId);

      expect(series.map((event) => [event.seriesIndex, event.seriesLength])).toEqual([[1, 3], [2, 3], [3, 3]]);
      expect(queries[0].filters).toEqual([["eq", "series_id", seriesId]]);
      expect(queries).toHaveLength(1);
    });

    it("returns nothing for a series the caller can't see", async () => {
      useDatabase([]);

      expect(await calendar.listSeries(uuid(5))).toEqual([]);
    });
  });

  describe("create", () => {
    const newRow = {
      seriesIndex: 1, seriesRepeat: "weekly" as const, title: "Swimming", notes: "", location: "", allDay: false,
      startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z", timezone: "Europe/Bucharest",
      notifyAt: "2026-11-03T06:30:00.000Z",
    };

    it("saves the rows through create_calendar_events and returns them with the attendees and length", async () => {
      const seriesId = uuid(5);
      const stored = [1, 2].map((index) => aRow({ series_id: seriesId, series_index: index, series_repeat: "weekly" }));
      const { rpcs } = useDatabase([], { rpc: () => ({ data: stored, error: null }) });

      const created = await calendar.create([newRow, { ...newRow, seriesIndex: 2 }], [kidId, momId, kidId]);

      expect(rpcs[1]).toEqual({
        fn: "create_calendar_events",
        args: {
          p_rows: [
            {
              series_index: 1, series_repeat: "weekly", title: "Swimming", notes: "", location: "", all_day: false,
              starts_at: "2026-11-03T07:00:00.000Z", ends_at: "2026-11-03T08:00:00.000Z",
              timezone: "Europe/Bucharest", notify_at: "2026-11-03T06:30:00.000Z",
            },
            expect.objectContaining({ series_index: 2 }),
          ],
          p_member_ids: [kidId, momId, kidId],
        },
      });
      expect(created.map((event) => [event.id, event.seriesIndex, event.seriesLength])).toEqual([
        [stored[0].id, 1, 2], [stored[1].id, 2, 2],
      ]);
      expect(created[0].attendees).toEqual([mum, ana]);
    });

    it("refuses a caller without a family before calling the function", async () => {
      const { rpcs } = useDatabase([], { family: null });

      await expect(calendar.create([newRow], [momId])).rejects.toMatchObject({ status: 404, message: NO_FAMILY_MESSAGE });
      expect(rpcs.map((call) => call.fn)).toEqual(["get_family"]);
    });

    it.each([
      ["an attendee outside the family", { code: "23514", message: "An event can only be for members of its family." }, 422],
      ["no attendees", { code: "22023", message: "Choose who the event is for." }, 422],
      ["no family", { code: "42501", message: "Join or create a family to use the calendar." }, 403],
    ])("maps %s to a %i DomainError", async (_name, failure, status) => {
      useDatabase([], { rpc: () => ({ data: null, error: failure }) });

      await expect(calendar.create([newRow], [momId])).rejects.toMatchObject({ status });
    });

    it("keeps any other failure, a table check included, private", async () => {
      useDatabase([], { rpc: () => ({ data: null, error: { code: "23514", message: 'violates check constraint "calendar_events_title_check"' } }) });

      await expect(calendar.create([newRow], [momId])).rejects.toThrow("Unable to save the event.");
    });
  });

  describe("update", () => {
    it("sends the id and only the given keys, then reads the changed events back with their attendees", async () => {
      const seriesId = uuid(5);
      const stored = [1, 2].map((index) => aRow({ series_id: seriesId, series_index: index, series_repeat: "weekly", title: "Diving", calendar_event_attendees: [{ member_id: kidId }] }));
      const { rpcs, queries } = useDatabase(stored, { rpc: () => ({ data: stored, error: null }) });

      const updated = await calendar.update(
        [
          { id: stored[0].id, title: "Diving", startsAt: "2026-11-03T08:30:00.000Z", notifyAt: "2026-11-03T08:00:00.000Z", notifiedAt: null },
          { id: stored[1].id, title: "Diving" },
        ],
        [kidId],
      );

      expect(rpcs[0]).toEqual({
        fn: "update_calendar_events",
        args: {
          p_rows: [
            { id: stored[0].id, title: "Diving", starts_at: "2026-11-03T08:30:00.000Z", notify_at: "2026-11-03T08:00:00.000Z", notified_at: null },
            { id: stored[1].id, title: "Diving" },
          ],
          p_member_ids: [kidId],
        },
      });
      expect(queries[0].filters).toEqual([["in", "id", [stored[0].id, stored[1].id]]]);
      expect(updated.map((event) => [event.id, event.seriesLength, event.attendees])).toEqual([
        [stored[0].id, 2, [ana]], [stored[1].id, 2, [ana]],
      ]);
    });

    it("sends no attendee list when none is given", async () => {
      const row = aRow();
      const { rpcs } = useDatabase([row], { rpc: () => ({ data: [row], error: null }) });

      await calendar.update([{ id: row.id }]);

      expect(rpcs[0].args).toEqual({ p_rows: [{ id: row.id }], p_member_ids: null });
    });

    it.each([
      ["an event that isn't there", { code: "P0002", message: EVENT_GONE_MESSAGE }, 404],
      ["an attendee outside the family", { code: "23514", message: "An event can only be for members of its family." }, 422],
      ["an empty attendee list", { code: "22023", message: "Choose who the event is for." }, 422],
    ])("maps %s to a %i DomainError", async (_name, failure, status) => {
      useDatabase([], { rpc: () => ({ data: null, error: failure }) });

      await expect(calendar.update([{ id: uuid(4) }], [momId])).rejects.toMatchObject({ status, message: failure.message });
    });
  });

  describe("delete", () => {
    it("deletes the events by id and returns the ids that existed", async () => {
      const [keep, gone] = [aRow(), aRow()];
      const { queries, tables } = useDatabase([keep, gone]);

      const deleted = await calendar.delete([gone.id, "40000000-0000-4000-8000-000000000999"]);

      expect(deleted).toEqual([gone.id]);
      expect(queries[0]).toMatchObject({ operation: "delete", filters: [["in", "id", [gone.id, "40000000-0000-4000-8000-000000000999"]]] });
      expect(tables.calendar_events).toEqual([keep]);
    });

    it("does nothing for no ids", async () => {
      const { queries } = useDatabase([aRow()]);

      expect(await calendar.delete([])).toEqual([]);
      expect(queries).toEqual([]);
    });

    it("keeps database failures private", async () => {
      useDatabase([], { fail: () => true });

      await expect(calendar.delete([uuid(4)])).rejects.toThrow("Unable to delete the event.");
    });
  });
});

describe("translateCalendarWriteError", () => {
  it("reads 23514 about the family as an attendee error with its field", () => {
    const error = translateCalendarWriteError({ code: "23514", message: "An event can only be for members of its family." }, "Unable.");

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ status: 422, fieldErrors: { attendeeMemberIds: [ATTENDEE_OUTSIDE_FAMILY_MESSAGE] } });
  });

  it("leaves other 23514s and unknown codes as a plain error with the fallback", () => {
    for (const code of ["23514", "XX000", undefined]) {
      const error = translateCalendarWriteError({ code, message: "private detail" }, "Unable.");
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error.message).toBe("Unable.");
    }
  });
});
