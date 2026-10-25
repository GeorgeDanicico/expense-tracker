import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { OCCURRENCE_ALREADY_DONE_MESSAGE, type ReminderValues } from "@/lib/reminders/repository";
import { fakeSupabase, type FakeSupabaseOptions } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);

import { supabaseReminderRepository as reminders } from "@/lib/supabase/repositories/reminders";

const userId = "10000000-0000-4000-8000-000000000171";

let nextId = 1;
function aRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `50000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    user_id: userId,
    title: "Pay rent",
    notes: "",
    starts_on: "2026-10-31",
    time_of_day: "09:00:00",
    timezone: "Europe/Bucharest",
    repeat_unit: "month",
    repeat_interval: 1,
    lead_minutes: [0, 4320],
    notifications_muted: false,
    next_due_on: "2026-10-31",
    next_due_at: "2026-10-31T07:00:00+00:00",
    snoozed_until: null,
    next_notify_at: "2026-10-28T07:00:00+00:00",
    notify_locked_until: null,
    expense_template: null,
    created_at: "2026-10-20T09:00:00+00:00",
    updated_at: "2026-10-20T09:00:00+00:00",
    ...overrides,
  };
}

/** `reminders` and `reminder_completions` rows behind RLS (the caller's own only). */
function useDatabase(
  tables: { reminders?: Record<string, unknown>[]; reminder_completions?: Record<string, unknown>[] },
  options: FakeSupabaseOptions = {},
) {
  const database = fakeSupabase({ reminders: [], reminder_completions: [], ...tables }, options);
  mocks.createClient.mockResolvedValue(database.client);
  return database;
}

const values: ReminderValues = {
  title: "Pay rent",
  notes: "",
  startsOn: "2026-10-31",
  timeOfDay: "09:00",
  timezone: "Europe/Bucharest",
  repeatUnit: "month",
  repeatInterval: 1,
  leadMinutes: [0, 4320],
  notificationsMuted: false,
  nextDueOn: "2026-10-31",
  nextDueAt: "2026-10-31T07:00:00.000Z",
  snoozedUntil: null,
  nextNotifyAt: "2026-10-28T07:00:00.000Z",
};

describe("Supabase reminder repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    nextId = 1;
  });

  describe("list", () => {
    it("returns reminders by due time (done one-offs last) and completions since doneSince, newest first", async () => {
      const later = aRow({ next_due_on: "2026-11-30", next_due_at: "2026-11-30T07:00:00+00:00" });
      const done = aRow({ repeat_unit: "none", next_due_on: null, next_due_at: null, next_notify_at: null });
      const sooner = aRow();
      const { queries } = useDatabase({
        reminders: [later, done, sooner],
        reminder_completions: [
          { id: "c1", reminder_id: done.id, occurrence_on: "2026-10-01", done_at: "2026-10-01T08:00:00+00:00", expense_id: null },
          { id: "c2", reminder_id: sooner.id, occurrence_on: "2026-09-30", done_at: "2026-10-02T08:00:00+00:00", expense_id: null },
          { id: "c3", reminder_id: sooner.id, occurrence_on: "2026-08-31", done_at: "2026-08-31T08:00:00+00:00", expense_id: null },
        ],
      });

      const listed = await reminders.list({ doneSince: "2026-09-25T00:00:00.000Z" });

      expect(listed.reminders.map((reminder) => reminder.id)).toEqual([sooner.id, later.id, done.id]);
      expect(listed.reminders[0]).toEqual({
        id: sooner.id,
        title: "Pay rent",
        notes: "",
        startsOn: "2026-10-31",
        timeOfDay: "09:00",
        timezone: "Europe/Bucharest",
        repeatUnit: "month",
        repeatInterval: 1,
        leadMinutes: [0, 4320],
        notificationsMuted: false,
        nextDueOn: "2026-10-31",
        nextDueAt: "2026-10-31T07:00:00.000Z",
        snoozedUntil: null,
        nextNotifyAt: "2026-10-28T07:00:00.000Z",
        createdAt: "2026-10-20T09:00:00.000Z",
        updatedAt: "2026-10-20T09:00:00.000Z",
      });
      expect(listed.completions).toEqual([
        { id: "c2", reminderId: sooner.id, occurrenceOn: "2026-09-30", doneAt: "2026-10-02T08:00:00.000Z", expenseId: null },
        { id: "c1", reminderId: done.id, occurrenceOn: "2026-10-01", doneAt: "2026-10-01T08:00:00.000Z", expenseId: null },
      ]);
      // RLS scopes both to the caller: no user filter of our own.
      expect(queries.map((query) => query.filters)).toEqual([[], [["gte", "done_at", "2026-09-25T00:00:00.000Z"]]]);
    });

    it("keeps database failures private", async () => {
      useDatabase({}, { fail: () => true });

      await expect(reminders.list({ doneSince: "2026-09-25T00:00:00.000Z" })).rejects.toThrow("Unable to load your reminders.");
    });
  });

  describe("get and lastCompletedOn", () => {
    it("returns the reminder, or null when RLS hides it", async () => {
      const row = aRow();
      useDatabase({ reminders: [row] });

      expect(await reminders.get(row.id)).toMatchObject({ id: row.id, timeOfDay: "09:00" });
      expect(await reminders.get("50000000-0000-4000-8000-000000000999")).toBeNull();
    });

    it("returns the latest occurrence marked done", async () => {
      const row = aRow();
      const { queries } = useDatabase({
        reminders: [row],
        reminder_completions: [
          { id: "c1", reminder_id: row.id, occurrence_on: "2026-08-31", done_at: "2026-08-31T08:00:00+00:00" },
          { id: "c2", reminder_id: row.id, occurrence_on: "2026-09-30", done_at: "2026-09-30T08:00:00+00:00" },
        ],
      });

      expect(await reminders.lastCompletedOn(row.id)).toBe("2026-09-30");
      expect(await reminders.lastCompletedOn("50000000-0000-4000-8000-000000000999")).toBeNull();
      expect(queries[0]).toMatchObject({ filters: [["eq", "reminder_id", row.id]], limits: ["1"] });
    });
  });

  describe("create", () => {
    it("inserts every field and the dates for the caller", async () => {
      // The column defaults the fake doesn't have.
      const { queries } = useDatabase({}, {
        trigger: (row) => ({ created_at: "2026-10-25T08:00:00+00:00", updated_at: "2026-10-25T08:00:00+00:00", ...row }),
      });

      const created = await reminders.create(userId, values);

      expect(queries[0].values).toEqual({
        user_id: userId,
        title: "Pay rent",
        notes: "",
        starts_on: "2026-10-31",
        time_of_day: "09:00",
        timezone: "Europe/Bucharest",
        repeat_unit: "month",
        repeat_interval: 1,
        lead_minutes: [0, 4320],
        notifications_muted: false,
        next_due_on: "2026-10-31",
        next_due_at: "2026-10-31T07:00:00.000Z",
        snoozed_until: null,
        next_notify_at: "2026-10-28T07:00:00.000Z",
      });
      expect(created).toMatchObject({ title: "Pay rent", nextDueOn: "2026-10-31" });
    });

    it("passes a known database error on as a DomainError", async () => {
      useDatabase({}, { fail: () => ({ code: "23514", message: "A reminder's lead times must be distinct." }) });

      await expect(reminders.create(userId, values)).rejects.toMatchObject({
        status: 422, message: "A reminder's lead times must be distinct.",
      });
    });

    it("keeps other failures private", async () => {
      useDatabase({}, { fail: () => true });

      await expect(reminders.create(userId, values)).rejects.toThrow("Unable to save the reminder.");
    });
  });

  describe("update and delete", () => {
    it("writes only the given fields, nulls included", async () => {
      const row = aRow();
      const { queries } = useDatabase({ reminders: [row] });

      const updated = await reminders.update(row.id, { snoozedUntil: "2026-10-31T08:00:00.000Z", nextNotifyAt: null });

      expect(queries[0]).toMatchObject({
        operation: "update",
        filters: [["eq", "id", row.id]],
        values: { snoozed_until: "2026-10-31T08:00:00.000Z", next_notify_at: null },
      });
      expect(updated).toMatchObject({ snoozedUntil: "2026-10-31T08:00:00.000Z", nextNotifyAt: null, title: "Pay rent" });
    });

    it("returns null for a reminder RLS hides", async () => {
      useDatabase({});

      expect(await reminders.update("50000000-0000-4000-8000-000000000999", { title: "Nope" })).toBeNull();
      expect(await reminders.delete("50000000-0000-4000-8000-000000000999")).toBe(false);
    });

    it("deletes the reminder", async () => {
      const row = aRow();
      const { tables } = useDatabase({ reminders: [row] });

      expect(await reminders.delete(row.id)).toBe(true);
      expect(tables.reminders).toEqual([]);
    });
  });

  describe("complete", () => {
    const next = { nextDueOn: "2026-11-30", nextDueAt: "2026-11-30T07:00:00.000Z", nextNotifyAt: "2026-11-27T07:00:00.000Z" };

    it("moves the open occurrence, clears the snooze and records the completion", async () => {
      const row = aRow({ snoozed_until: "2026-10-31T08:00:00+00:00" });
      const { queries, tables } = useDatabase({ reminders: [row] });

      const completed = await reminders.complete(row.id, "2026-10-31", next);

      expect(queries[0]).toMatchObject({
        operation: "update",
        filters: [["eq", "id", row.id], ["eq", "next_due_on", "2026-10-31"]],
        values: {
          next_due_on: "2026-11-30",
          next_due_at: "2026-11-30T07:00:00.000Z",
          next_notify_at: "2026-11-27T07:00:00.000Z",
          snoozed_until: null,
        },
      });
      expect(queries[1]).toMatchObject({
        table: "reminder_completions", operation: "insert", values: { reminder_id: row.id, occurrence_on: "2026-10-31" },
      });
      expect(completed).toMatchObject({ nextDueOn: "2026-11-30", snoozedUntil: null });
      expect(tables.reminder_completions).toHaveLength(1);
    });

    it("answers 409 when the occurrence was already marked done", async () => {
      const row = aRow({ next_due_on: "2026-11-30" });
      useDatabase({ reminders: [row] });

      const error = await reminders.complete(row.id, "2026-10-31", next).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ status: 409, message: OCCURRENCE_ALREADY_DONE_MESSAGE });
    });

    it("returns null for a reminder RLS hides", async () => {
      useDatabase({});

      expect(await reminders.complete("50000000-0000-4000-8000-000000000999", "2026-10-31", next)).toBeNull();
    });

    it("leaves a completion that already exists for that date", async () => {
      const row = aRow();
      useDatabase({ reminders: [row] }, {
        fail: (query) => query.table === "reminder_completions"
          && { code: "23505", message: "duplicate key value violates unique constraint" },
      });

      expect(await reminders.complete(row.id, "2026-10-31", next)).toMatchObject({ nextDueOn: "2026-11-30" });
    });
  });

  describe("summary", () => {
    it("counts due and overdue reminders", async () => {
      useDatabase({
        reminders: [
          aRow({ next_due_on: "2026-10-24" }), // overdue
          aRow({ next_due_on: "2026-10-25", time_of_day: "18:00:00" }), // due
          aRow({ next_due_on: "2026-10-24", snoozed_until: "2026-10-25T11:00:00+00:00" }), // snoozed
          aRow({ next_due_on: "2026-10-26" }), // upcoming
          aRow({ next_due_on: null }), // done
        ],
      });

      expect(await reminders.summary(new Date("2026-10-25T10:00:00Z"))).toEqual({ due: 1, overdue: 1 });
    });
  });
});
