import { beforeEach, describe, expect, it, vi } from "vitest";

import { OCCURRENCE_ALREADY_DONE_MESSAGE } from "@/lib/reminders/repository";
import { reminderSchema } from "@/lib/validation/reminder";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import {
  REMINDER_DONE_MESSAGE,
  REMINDER_NOT_FOUND_MESSAGE,
  completeReminder,
  createReminder,
  defaultDoneSince,
  deleteReminder,
  getReminder,
  listReminders,
  reminderSummary,
  snoozeReminder,
  updateReminder,
} from "@/lib/reminders/service";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";

/** A form submission, through the schema as a route would parse it. */
function input(fields: Record<string, unknown> = {}) {
  return reminderSchema.parse({ title: "Pay rent", startsOn: "2026-10-31", ...fields });
}

let repositories: FakeRepositories;

describe("reminders service", () => {
  beforeEach(() => {
    repositories = resetFakeRepositories();
  });

  describe("createReminder", () => {
    it("stores the first date as the open occurrence, its instant and the next notify time", async () => {
      // 25 October 2026 is the autumn DST change in Bucharest: from then on 09:00 is 07:00 UTC.
      const now = new Date("2026-10-25T08:00:00Z");

      const created = await createReminder(
        userId,
        input({ repeatUnit: "month", leadMinutes: [0, 4320] }),
        now,
      );

      expect(created).toMatchObject({
        startsOn: "2026-10-31",
        timeOfDay: "09:00",
        timezone: "Europe/Bucharest",
        nextDueOn: "2026-10-31",
        nextDueAt: "2026-10-31T07:00:00.000Z",
        snoozedUntil: null,
        // 3 days before, at 09:00 local.
        nextNotifyAt: "2026-10-28T07:00:00.000Z",
        state: "upcoming",
      });
      expect(repositories.reminders.rows[0]).toMatchObject({ id: created.id, userId });
    });

    it("stores no notify time when muted, or when every lead time has passed", async () => {
      const now = new Date("2026-10-25T08:00:00Z");

      const muted = await createReminder(userId, input({ notificationsMuted: true }), now);
      const past = await createReminder(userId, input({ startsOn: "2026-10-20" }), now);

      expect(muted).toMatchObject({ nextDueOn: "2026-10-31", nextNotifyAt: null });
      expect(past).toMatchObject({ nextDueOn: "2026-10-20", nextNotifyAt: null, state: "overdue" });
    });
  });

  describe("updateReminder", () => {
    it("works the dates out again from the new first date and time", async () => {
      const now = new Date("2026-10-25T08:00:00Z");
      const { id } = await createReminder(userId, input(), now);

      const updated = await updateReminder(id, input({ startsOn: "2026-11-05", timeOfDay: "18:30", leadMinutes: [60] }), now);

      expect(updated).toMatchObject({
        title: "Pay rent",
        nextDueOn: "2026-11-05",
        nextDueAt: "2026-11-05T16:30:00.000Z",
        nextNotifyAt: "2026-11-05T15:30:00.000Z",
      });
    });

    it("clears next_notify_at when muted, and works it out again when unmuted", async () => {
      const now = new Date("2026-10-25T08:00:00Z");
      const { id } = await createReminder(userId, input(), now);

      const muted = await updateReminder(id, input({ notificationsMuted: true }), now);
      expect(muted).toMatchObject({ notificationsMuted: true, nextDueOn: "2026-10-31", nextNotifyAt: null });

      const unmuted = await updateReminder(id, input(), now);
      expect(unmuted.nextNotifyAt).toBe("2026-10-31T07:00:00.000Z");
    });

    it("places the open occurrence after the latest one marked done", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-09-30", repeatUnit: "month" }), new Date("2026-09-01T00:00:00Z"));
      await completeReminder(id, new Date("2026-09-30T08:00:00Z"));

      // Moving the first date back doesn't bring back a done month; the 15th of October is next.
      const now = new Date("2026-10-01T08:00:00Z");
      const updated = await updateReminder(id, input({ startsOn: "2026-08-15", repeatUnit: "month" }), now);

      expect(updated.nextDueOn).toBe("2026-10-15");
    });

    it("keeps a snooze while the open occurrence stays, and drops it when it moves", async () => {
      const now = new Date("2026-10-31T08:00:00Z");
      const { id } = await createReminder(userId, input(), now);
      const snoozed = await snoozeReminder(id, { kind: "hour" }, now);

      const renamed = await updateReminder(id, input({ title: "Pay the rent" }), now);
      expect(renamed).toMatchObject({ snoozedUntil: snoozed.snoozedUntil, nextNotifyAt: snoozed.snoozedUntil });

      const moved = await updateReminder(id, input({ title: "Pay the rent", startsOn: "2026-11-02" }), now);
      expect(moved).toMatchObject({ nextDueOn: "2026-11-02", snoozedUntil: null, nextNotifyAt: "2026-11-02T07:00:00.000Z" });
    });

    it("reopens a done one-off only when its date moves past the done one", async () => {
      const { id } = await createReminder(userId, input(), new Date("2026-10-25T08:00:00Z"));
      await completeReminder(id, new Date("2026-10-31T08:00:00Z"));
      const now = new Date("2026-11-01T08:00:00Z");

      expect(await updateReminder(id, input({ title: "Renamed" }), now)).toMatchObject({ nextDueOn: null, state: "done" });
      expect(await updateReminder(id, input({ startsOn: "2026-11-10" }), now)).toMatchObject({
        nextDueOn: "2026-11-10", state: "upcoming",
      });
    });

    it("answers 404 for a missing reminder", async () => {
      await expect(updateReminder("missing", input())).rejects.toMatchObject({
        status: 404, message: REMINDER_NOT_FOUND_MESSAGE,
      });
    });
  });

  describe("completeReminder", () => {
    it("moves a monthly reminder on the 31st two months when completed twice", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-01-31", repeatUnit: "month" }), new Date("2026-01-20T00:00:00Z"));
      const now = new Date("2026-02-01T10:00:00Z");

      const first = await completeReminder(id, now);
      expect(first).toMatchObject({
        nextDueOn: "2026-02-28", nextDueAt: "2026-02-28T07:00:00.000Z", nextNotifyAt: "2026-02-28T07:00:00.000Z", state: "upcoming",
      });

      const second = await completeReminder(id, now);
      // Back on the 31st, and in summer time (UTC+3) since 29 March.
      expect(second).toMatchObject({
        nextDueOn: "2026-03-31", nextDueAt: "2026-03-31T06:00:00.000Z", nextNotifyAt: "2026-03-31T06:00:00.000Z",
      });
      expect(repositories.reminders.completions.map((completion) => completion.occurrenceOn)).toEqual(["2026-01-31", "2026-02-28"]);
    });

    it("clears the snooze", async () => {
      const now = new Date("2026-10-31T08:00:00Z");
      const { id } = await createReminder(userId, input({ repeatUnit: "week" }), now);
      await snoozeReminder(id, { kind: "hour" }, now);

      const completed = await completeReminder(id, now);

      expect(completed).toMatchObject({
        nextDueOn: "2026-11-07", snoozedUntil: null, nextNotifyAt: "2026-11-07T07:00:00.000Z",
      });
    });

    it("moves a one-off to done, and a second call is a 409", async () => {
      const now = new Date("2026-10-31T08:00:00Z");
      const { id } = await createReminder(userId, input(), now);

      const done = await completeReminder(id, now);

      expect(done).toMatchObject({ nextDueOn: null, nextDueAt: null, nextNotifyAt: null, snoozedUntil: null, state: "done" });
      expect(repositories.reminders.completions).toEqual([expect.objectContaining({ reminderId: id, occurrenceOn: "2026-10-31" })]);
      await expect(completeReminder(id, now)).rejects.toMatchObject({ status: 409, message: REMINDER_DONE_MESSAGE });
    });

    it("lets only one of two requests for the same occurrence through", async () => {
      const now = new Date("2026-10-31T08:00:00Z");
      const { id } = await createReminder(userId, input({ repeatUnit: "month" }), now);

      const results = await Promise.allSettled([completeReminder(id, now), completeReminder(id, now)]);

      expect(results.map((result) => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({
        reason: { status: 409, message: OCCURRENCE_ALREADY_DONE_MESSAGE },
      });
      expect(repositories.reminders.rows[0].nextDueOn).toBe("2026-11-30");
      expect(repositories.reminders.completions).toHaveLength(1);
    });

    it("answers 404 for another user's reminder", async () => {
      const theirs = repositories.reminders.seed({ userId: otherUserId });

      await expect(completeReminder(theirs.id)).rejects.toMatchObject({ status: 404 });
      expect(theirs.nextDueOn).toBe("2026-11-01");
    });
  });

  describe("snoozeReminder", () => {
    // Overdue: 09:00 on 25 October was 06:00 UTC (summer time ended at 04:00 that morning).
    const now = new Date("2026-10-25T10:00:00Z");

    it("snoozes for an hour: it leaves Overdue and notifies when the snooze ends", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-10-25" }), now);

      const snoozed = await snoozeReminder(id, { kind: "hour" }, now);

      expect(snoozed).toMatchObject({
        snoozedUntil: "2026-10-25T11:00:00.000Z", nextNotifyAt: "2026-10-25T11:00:00.000Z", state: "snoozed",
      });
    });

    it("snoozes until tomorrow at 09:00 local time", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-10-25" }), now);

      const snoozed = await snoozeReminder(id, { kind: "tomorrow" }, now);

      expect(snoozed).toMatchObject({ snoozedUntil: "2026-10-26T07:00:00.000Z", nextNotifyAt: "2026-10-26T07:00:00.000Z" });
    });

    it("stores no notify time for a muted reminder", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-10-25", notificationsMuted: true }), now);

      const snoozed = await snoozeReminder(id, { kind: "until", until: "2026-10-25T15:00:00.000Z" }, now);

      expect(snoozed).toMatchObject({ snoozedUntil: "2026-10-25T15:00:00.000Z", nextNotifyAt: null, state: "snoozed" });
    });

    it("refuses a done one-off with a 409 and a missing reminder with a 404", async () => {
      const { id } = await createReminder(userId, input({ startsOn: "2026-10-25" }), now);
      await completeReminder(id, now);

      await expect(snoozeReminder(id, { kind: "hour" }, now)).rejects.toMatchObject({ status: 409 });
      await expect(snoozeReminder("missing", { kind: "hour" }, now)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("reading", () => {
    it("lists the caller's reminders with their state, and recent completions", async () => {
      const now = new Date("2026-10-25T10:00:00Z");
      const overdue = await createReminder(userId, input({ startsOn: "2026-10-25", repeatUnit: "week" }), now);
      const upcoming = await createReminder(userId, input({ startsOn: "2026-11-02" }), now);
      repositories.reminders.seed({ userId: otherUserId });
      await completeReminder(overdue.id, now);
      repositories.reminders.completions.push({
        id: "old", reminderId: upcoming.id, occurrenceOn: "2026-01-01", doneAt: "2026-01-01T00:00:00.000Z", expenseId: null,
      });

      const { reminders, completions } = await listReminders(defaultDoneSince(now), now);

      expect(reminders.map((reminder) => [reminder.id, reminder.state])).toEqual([
        // Marked done, so on to 1 November.
        [overdue.id, "upcoming"],
        [upcoming.id, "upcoming"],
      ]);
      expect(completions).toEqual([expect.objectContaining({ reminderId: overdue.id, occurrenceOn: "2026-10-25" })]);
    });

    it("counts due and overdue reminders for the badge", async () => {
      const now = new Date("2026-10-25T10:00:00Z");
      await createReminder(userId, input({ startsOn: "2026-10-24" }), now); // overdue
      await createReminder(userId, input({ startsOn: "2026-10-25", timeOfDay: "18:00" }), now); // due
      const snoozed = await createReminder(userId, input({ startsOn: "2026-10-25" }), now);
      await snoozeReminder(snoozed.id, { kind: "hour" }, now);
      await createReminder(userId, input({ startsOn: "2026-10-26" }), now); // upcoming
      repositories.reminders.seed({ userId: otherUserId, nextDueOn: "2026-10-20" });

      expect(await reminderSummary(now)).toEqual({ due: 1, overdue: 1 });
    });

    it("gets and deletes only the caller's reminders", async () => {
      const mine = await createReminder(userId, input());
      const theirs = repositories.reminders.seed({ userId: otherUserId });

      expect(await getReminder(mine.id)).toMatchObject({ id: mine.id });
      await expect(getReminder(theirs.id)).rejects.toMatchObject({ status: 404 });
      await expect(deleteReminder(theirs.id)).rejects.toMatchObject({ status: 404 });
      await deleteReminder(mine.id);
      expect(repositories.reminders.rows.map((row) => row.id)).toEqual([theirs.id]);
    });
  });
});
