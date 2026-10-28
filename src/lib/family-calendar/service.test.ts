import { beforeEach, describe, expect, it, vi } from "vitest";

import { ATTENDEE_OUTSIDE_FAMILY_MESSAGE } from "@/lib/family-calendar/repository";
import { utcToZoned } from "@/lib/time-zone";
import { calendarEventEditSchema, calendarEventSchema } from "@/lib/validation/calendar-event";
import { aFamily, aFamilyMember, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import {
  EVENT_NOT_FOUND_MESSAGE,
  MAX_RANGE_MS,
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  updateEvent,
} from "@/lib/family-calendar/service";

const BUCHAREST = "Europe/Bucharest";
const otherFamilyId = "70000000-0000-4000-8000-000000000999";
const parentMemberId = aParent().memberId;
const kid = aFamilyMember({ displayName: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" });
const outsiderMemberId = "60000000-0000-4000-8000-000000000999";

// 28 October 2026, after the autumn clock change of the 25th: Bucharest is UTC+2.
const now = new Date("2026-10-28T08:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/** A new event through the schema, as a route would parse it: 3 November 2026, 09:00 to 10:00, just the parent. */
function newEvent(fields: Record<string, unknown> = {}) {
  return calendarEventSchema.parse({
    title: "Swimming",
    startDate: "2026-11-03",
    startTime: "09:00",
    endTime: "10:00",
    attendeeMemberIds: [parentMemberId],
    ...fields,
  });
}

/** An edit through the schema. */
function anEdit(fields: Record<string, unknown>) {
  return calendarEventEditSchema.parse(fields);
}

const weekly = (count: number) => ({ repeat: { kind: "weekly", count } });

/** The local date and time an instant shows in Bucharest, as `2026-11-03 09:00`. */
const local = (instant: string) => {
  const { date, time } = utcToZoned(new Date(instant), BUCHAREST);
  return `${date} ${time}`;
};

let repositories: FakeRepositories;

describe("calendar service", () => {
  beforeEach(() => {
    repositories = resetFakeRepositories();
    repositories.family.membership = aParent();
    repositories.family.family = { ...aFamily(), members: [...aFamily().members, kid] };
  });

  describe("createEvent", () => {
    it("adds a one-off with its attendees joined, and notifies 30 minutes before", async () => {
      const created = await createEvent(newEvent({ notes: "Bring a towel", location: "The pool" }), now);

      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        title: "Swimming",
        notes: "Bring a towel",
        location: "The pool",
        allDay: false,
        // 09:00 in Bucharest is 07:00 UTC after the clock change.
        startsAt: "2026-11-03T07:00:00.000Z",
        endsAt: "2026-11-03T08:00:00.000Z",
        timezone: BUCHAREST,
        seriesIndex: 1,
        seriesLength: 1,
        seriesRepeat: "none",
        attendees: [{ memberId: parentMemberId, name: "owner", color: null, avatarUrl: null }],
        createdBy: repositories.family.caller.userId,
      });
      expect(repositories.calendar.rows[0]).toMatchObject({
        familyId: aParent().familyId,
        notifyAt: "2026-11-03T06:30:00.000Z",
        notifiedAt: null,
      });
    });

    it("adds a 6-week weekly series as one row per week, sharing a series, each keeping 09:00 local", async () => {
      const created = await createEvent(newEvent({ ...weekly(6), attendeeMemberIds: [parentMemberId, kid.memberId] }), now);

      expect(created.map((event) => event.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(created.map((event) => event.seriesId)).size).toBe(1);
      expect(created.map((event) => local(event.startsAt))).toEqual([
        "2026-11-03 09:00", "2026-11-10 09:00", "2026-11-17 09:00",
        "2026-11-24 09:00", "2026-12-01 09:00", "2026-12-08 09:00",
      ]);
      expect(created.every((event) => event.seriesLength === 6 && event.seriesRepeat === "weekly")).toBe(true);
      expect(created.every((event) => event.attendees.map((a) => a.memberId).join() === [parentMemberId, kid.memberId].join()))
        .toBe(true);
      expect(created[1].attendees[1]).toEqual({ memberId: kid.memberId, name: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" });
      // Each occurrence has its own notify time, 30 minutes before it.
      expect(repositories.calendar.rows.map((row) => row.notifyAt)).toEqual(
        created.map((event) => new Date(Date.parse(event.startsAt) - 30 * 60_000).toISOString()),
      );
    });

    it("keeps the local time of a series across the clock change", async () => {
      const created = await createEvent(
        newEvent({ startDate: "2026-10-20", ...weekly(3) }),
        new Date("2026-10-01T00:00:00.000Z"),
      );

      expect(created.map((event) => event.startsAt)).toEqual([
        "2026-10-20T06:00:00.000Z", // EEST, UTC+3
        "2026-10-27T07:00:00.000Z", // after the change of the 25th, UTC+2
        "2026-11-03T07:00:00.000Z",
      ]);
      expect(created.map((event) => local(event.startsAt).slice(11))).toEqual(["09:00", "09:00", "09:00"]);
    });

    it("adds a daily series of 10", async () => {
      const created = await createEvent(newEvent({ repeat: { kind: "daily", count: 10 } }), now);

      expect(created).toHaveLength(10);
      expect(local(created[9].startsAt)).toBe("2026-11-12 09:00");
      expect(created[9]).toMatchObject({ seriesIndex: 10, seriesLength: 10, seriesRepeat: "daily" });
    });

    it("notifies at 07:30 local on the first day of an all-day event", async () => {
      const [event] = await createEvent(
        newEvent({ allDay: true, startTime: null, endTime: null, endDate: "2026-11-05" }),
        now,
      );

      expect(event).toMatchObject({
        allDay: true,
        startsAt: "2026-11-02T22:00:00.000Z", // local midnight of the 3rd
        endsAt: "2026-11-05T22:00:00.000Z", // local midnight after the 5th
      });
      expect(repositories.calendar.rows[0].notifyAt).toBe("2026-11-03T05:30:00.000Z");
    });

    it("stores no notify time for an occurrence whose time has passed", async () => {
      // 30 minutes before the first one (06:30 UTC) is past; the second one's is not.
      await createEvent(newEvent({ ...weekly(2) }), new Date("2026-11-03T06:45:00.000Z"));

      expect(repositories.calendar.rows.map((row) => row.notifyAt)).toEqual([null, "2026-11-10T06:30:00.000Z"]);
    });

    it("refuses an attendee outside the family with a 422 and stores nothing", async () => {
      await expect(createEvent(newEvent({ ...weekly(3), attendeeMemberIds: [outsiderMemberId] }), now)).rejects.toMatchObject({
        status: 422,
        message: ATTENDEE_OUTSIDE_FAMILY_MESSAGE,
        fieldErrors: { attendeeMemberIds: [ATTENDEE_OUTSIDE_FAMILY_MESSAGE] },
      });
      expect(repositories.calendar.rows).toEqual([]);
    });
  });

  describe("getEvent", () => {
    it("returns the event with its series length, and refuses a missing or another family's event", async () => {
      const [first] = await createEvent(newEvent(weekly(4)), now);
      const foreign = repositories.calendar.seed({ familyId: otherFamilyId });

      expect(await getEvent(first.id)).toMatchObject({ id: first.id, seriesLength: 4 });
      for (const id of [foreign.id, "40000000-0000-4000-8000-000000000999"]) {
        await expect(getEvent(id)).rejects.toMatchObject({ status: 404, message: EVENT_NOT_FOUND_MESSAGE });
      }
    });
  });

  describe("listEvents", () => {
    const from = new Date("2026-11-01T00:00:00.000Z");
    const to = new Date("2026-12-01T00:00:00.000Z");

    it("lists the family's events overlapping the range by start, and nothing of another family", async () => {
      const [late] = await createEvent(newEvent({ startDate: "2026-11-20" }), now);
      const [early] = await createEvent(newEvent({ startDate: "2026-11-02" }), now);
      // Starts before the range and ends inside it: overlaps.
      const spanning = repositories.calendar.seed({ startsAt: "2026-10-31T22:00:00.000Z", endsAt: "2026-11-01T06:00:00.000Z" });
      // Ends exactly as the range starts, starts exactly as it ends: neither overlaps.
      repositories.calendar.seed({ startsAt: "2026-10-31T23:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z" });
      repositories.calendar.seed({ startsAt: "2026-12-01T00:00:00.000Z", endsAt: "2026-12-01T01:00:00.000Z" });
      repositories.calendar.seed({ familyId: otherFamilyId, startsAt: "2026-11-10T07:00:00.000Z", endsAt: "2026-11-10T08:00:00.000Z" });

      const listed = await listEvents({ from, to });

      expect(listed.map((event) => event.id)).toEqual([spanning.id, early.id, late.id]);
    });

    it("filters by the member who attends", async () => {
      const [mine] = await createEvent(newEvent({ startDate: "2026-11-02", attendeeMemberIds: [parentMemberId] }), now);
      const [kids] = await createEvent(newEvent({ startDate: "2026-11-03", attendeeMemberIds: [kid.memberId] }), now);
      const [both] = await createEvent(
        newEvent({ startDate: "2026-11-04", attendeeMemberIds: [parentMemberId, kid.memberId] }),
        now,
      );

      const ids = async (memberId?: string) => (await listEvents({ from, to, memberId })).map((event) => event.id);

      expect(await ids()).toEqual([mine.id, kids.id, both.id]);
      expect(await ids(parentMemberId)).toEqual([mine.id, both.id]);
      expect(await ids(kid.memberId)).toEqual([kids.id, both.id]);
      expect(await ids(outsiderMemberId)).toEqual([]);
    });

    it("allows a range of 92 days and refuses a longer, an empty or an invalid one without reading", async () => {
      const start = new Date("2026-09-01T00:00:00.000Z");
      await expect(listEvents({ from: start, to: new Date(start.getTime() + 92 * DAY) })).resolves.toEqual([]);
      // 92 wall-clock days across the autumn change are an hour longer.
      await expect(listEvents({ from: start, to: new Date(start.getTime() + MAX_RANGE_MS) })).resolves.toEqual([]);
      repositories.calendar.calls.length = 0;

      await expect(listEvents({ from: start, to: new Date(start.getTime() + 93 * DAY) })).rejects.toMatchObject({
        status: 422,
        fieldErrors: { to: ["The range can cover at most 92 days."] },
      });
      await expect(listEvents({ from: to, to: from })).rejects.toMatchObject({ status: 422, fieldErrors: { to: expect.any(Array) } });
      await expect(listEvents({ from, to: from })).rejects.toMatchObject({ status: 422 });
      await expect(listEvents({ from: new Date("nope"), to })).rejects.toMatchObject({ status: 422, fieldErrors: { from: expect.any(Array) } });
      expect(repositories.calendar.calls).toEqual([]);
    });

    it("answers a caller without a family with a 404", async () => {
      repositories.family.membership = null;

      await expect(listEvents({ from, to })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("updateEvent", () => {
    /** A weekly series of 6 at 09:00 on Tuesdays from 3 November, the first notified already. */
    async function aSeries() {
      const created = await createEvent(newEvent(weekly(6)), now);
      for (const row of repositories.calendar.rows) row.notifiedAt = "2026-11-03T06:31:00.000Z";
      return created;
    }
    const row = (index: number) => repositories.calendar.rows.find((candidate) => candidate.seriesIndex === index)!;
    const notified = () => repositories.calendar.rows.map((candidate) => candidate.notifiedAt !== null);

    it("changes only the text of this event, leaving the notify bookkeeping alone", async () => {
      const [, second] = await aSeries();

      const updated = await updateEvent(second.id, anEdit({ title: "Diving", location: "Pool B" }), now);

      expect(updated.map((event) => event.id)).toEqual([second.id]);
      expect(row(2)).toMatchObject({ title: "Diving", location: "Pool B", notes: "" });
      expect(row(1).title).toBe("Swimming");
      expect(row(3).title).toBe("Swimming");
      expect(notified()).toEqual(Array(6).fill(true));
    });

    it("moves one event's time: this occurrence only, its notify time worked out again and notified cleared", async () => {
      const [, , third] = await aSeries();

      const [updated] = await updateEvent(third.id, anEdit({ startTime: "10:30", endTime: "11:30" }), now);

      expect(local(updated.startsAt)).toBe("2026-11-17 10:30");
      expect(row(3)).toMatchObject({
        startsAt: "2026-11-17T08:30:00.000Z",
        endsAt: "2026-11-17T09:30:00.000Z",
        notifyAt: "2026-11-17T08:00:00.000Z",
        notifiedAt: null,
      });
      expect(row(2).startsAt).toBe("2026-11-10T07:00:00.000Z");
      expect(notified()).toEqual([true, true, false, true, true, true]);
    });

    it("applies a time change to this and the following events, from the 4th of 6", async () => {
      const [, , , fourth] = await aSeries();

      const updated = await updateEvent(fourth.id, anEdit({ scope: "following", startTime: "10:30", endTime: "11:30" }), now);

      expect(updated.map((event) => event.seriesIndex)).toEqual([4, 5, 6]);
      expect(repositories.calendar.rows.map((candidate) => local(candidate.startsAt))).toEqual([
        "2026-11-03 09:00", "2026-11-10 09:00", "2026-11-17 09:00",
        "2026-11-24 10:30", "2026-12-01 10:30", "2026-12-08 10:30",
      ]);
      expect(repositories.calendar.rows.map((candidate) => candidate.notifyAt)).toEqual([
        "2026-11-03T06:30:00.000Z", "2026-11-10T06:30:00.000Z", "2026-11-17T06:30:00.000Z",
        "2026-11-24T08:00:00.000Z", "2026-12-01T08:00:00.000Z", "2026-12-08T08:00:00.000Z",
      ]);
      expect(notified()).toEqual([true, true, true, false, false, false]);
    });

    it("treats following on the first occurrence as all", async () => {
      const [first] = await aSeries();

      const updated = await updateEvent(first.id, anEdit({ scope: "following", title: "Diving" }), now);

      expect(updated).toHaveLength(6);
      expect(repositories.calendar.rows.every((candidate) => candidate.title === "Diving")).toBe(true);
    });

    it("shifts every date of the series by the days the opened event moved, keeping the times", async () => {
      const [, second] = await aSeries();

      // The second is on 10 November; moving it to the 12th moves all six by two days.
      const updated = await updateEvent(second.id, anEdit({ scope: "all", startDate: "2026-11-12" }), now);

      expect(updated).toHaveLength(6);
      expect(repositories.calendar.rows.map((candidate) => local(candidate.startsAt))).toEqual([
        "2026-11-05 09:00", "2026-11-12 09:00", "2026-11-19 09:00",
        "2026-11-26 09:00", "2026-12-03 09:00", "2026-12-10 09:00",
      ]);
      expect(repositories.calendar.rows.map((candidate) => local(candidate.endsAt))[5]).toBe("2026-12-10 10:00");
      expect(row(1).notifyAt).toBe("2026-11-05T06:30:00.000Z");
      expect(notified()).toEqual(Array(6).fill(false));
    });

    it("clears notify_at and notified_at for an event moved into the past", async () => {
      const [first] = await aSeries();

      await updateEvent(first.id, anEdit({ startDate: "2026-10-20" }), now);

      expect(row(1)).toMatchObject({ startsAt: "2026-10-20T06:00:00.000Z", notifyAt: null, notifiedAt: null });
    });

    it("keeps notify_at and notified_at when only the end changes", async () => {
      const [first] = await aSeries();

      await updateEvent(first.id, anEdit({ endTime: "11:00" }), now);

      expect(row(1)).toMatchObject({
        endsAt: "2026-11-03T09:00:00.000Z",
        notifyAt: "2026-11-03T06:30:00.000Z",
        notifiedAt: "2026-11-03T06:31:00.000Z",
      });
    });

    it("works the notify time out again when an event becomes all-day", async () => {
      const [first] = await aSeries();

      await updateEvent(first.id, anEdit({ allDay: true }), now);

      expect(row(1)).toMatchObject({
        allDay: true,
        startsAt: "2026-11-02T22:00:00.000Z",
        endsAt: "2026-11-03T22:00:00.000Z",
        notifyAt: "2026-11-03T05:30:00.000Z",
        notifiedAt: null,
      });
    });

    it("replaces the attendees of this event only, or of every one in the scope", async () => {
      const [, second] = await aSeries();

      await updateEvent(second.id, anEdit({ attendeeMemberIds: [kid.memberId] }), now);
      expect(repositories.calendar.rows.map((candidate) => candidate.memberIds)).toEqual([
        [parentMemberId], [kid.memberId], [parentMemberId], [parentMemberId], [parentMemberId], [parentMemberId],
      ]);

      const updated = await updateEvent(second.id, anEdit({ scope: "following", attendeeMemberIds: [parentMemberId, kid.memberId] }), now);
      expect(updated.map((event) => event.attendees.map((attendee) => attendee.name))).toEqual(
        Array(5).fill(["owner", "Ana"]),
      );
      expect(repositories.calendar.rows.map((candidate) => candidate.memberIds.length)).toEqual([1, 2, 2, 2, 2, 2]);
      // Text and times were not part of the edit.
      expect(notified()).toEqual(Array(6).fill(true));
    });

    it("edits a one-off by any scope", async () => {
      const [only] = await createEvent(newEvent(), now);

      const updated = await updateEvent(only.id, anEdit({ scope: "all", title: "Diving" }), now);

      expect(updated).toMatchObject([{ id: only.id, title: "Diving", seriesLength: 1 }]);
    });

    it("refuses an invalid result with a 422 and changes nothing", async () => {
      const [first] = await aSeries();

      await expect(updateEvent(first.id, anEdit({ scope: "all", startTime: "11:00" }), now)).rejects.toMatchObject({
        status: 422,
        fieldErrors: { endTime: expect.any(Array) },
      });
      expect(repositories.calendar.rows.every((candidate) => local(candidate.startsAt).endsWith("09:00"))).toBe(true);
      expect(repositories.calendar.calls).not.toContain("update");
    });

    it("refuses an attendee outside the family with a 422 and changes nothing", async () => {
      const [first] = await aSeries();

      await expect(updateEvent(first.id, anEdit({ scope: "all", title: "Diving", attendeeMemberIds: [outsiderMemberId] }), now))
        .rejects.toMatchObject({ status: 422, message: ATTENDEE_OUTSIDE_FAMILY_MESSAGE });
      expect(repositories.calendar.rows.every((candidate) => candidate.title === "Swimming")).toBe(true);
    });

    it("answers another family's event, or none, with a 404 for every scope", async () => {
      const foreign = repositories.calendar.seed({ familyId: otherFamilyId });

      for (const scope of ["this", "following", "all"] as const) {
        for (const id of [foreign.id, "40000000-0000-4000-8000-000000000999"]) {
          await expect(updateEvent(id, anEdit({ scope, title: "Mine now" }), now)).rejects.toMatchObject({
            status: 404,
            message: EVENT_NOT_FOUND_MESSAGE,
          });
        }
      }
      expect(foreign.title).toBe("Swimming");
    });

    it("answers a 404 when the event is deleted between the reads and the write", async () => {
      const [, second] = await aSeries();
      const { calendar } = repositories;
      const update = calendar.update.bind(calendar);
      vi.spyOn(calendar, "update").mockImplementation(async (rows, memberIds) => {
        calendar.rows = calendar.rows.filter((candidate) => candidate.id !== second.id);
        return update(rows, memberIds);
      });

      await expect(updateEvent(second.id, anEdit({ scope: "all", title: "Diving" }), now)).rejects.toMatchObject({ status: 404 });
      expect(calendar.rows.every((candidate) => candidate.title === "Swimming")).toBe(true);
    });
  });

  describe("deleteEvent", () => {
    async function aSeries() {
      return createEvent(newEvent(weekly(6)), now);
    }
    const indexes = () => repositories.calendar.rows.map((candidate) => candidate.seriesIndex);

    it("deletes this event only, by default", async () => {
      const [, , third] = await aSeries();

      expect(await deleteEvent(third.id)).toEqual([third.id]);
      expect(indexes()).toEqual([1, 2, 4, 5, 6]);
      // The others now count 5 occurrences.
      expect((await getEvent(repositories.calendar.rows[0].id)).seriesLength).toBe(5);
    });

    it("deletes this and the following events", async () => {
      const created = await aSeries();

      const deleted = await deleteEvent(created[3].id, "following");

      expect(deleted).toEqual([created[3].id, created[4].id, created[5].id]);
      expect(indexes()).toEqual([1, 2, 3]);
    });

    it("deletes the whole series from any of its events", async () => {
      const created = await aSeries();
      const other = await createEvent(newEvent({ title: "Dentist" }), now);

      const deleted = await deleteEvent(created[2].id, "all");

      expect(deleted).toHaveLength(6);
      expect(repositories.calendar.rows.map((candidate) => candidate.id)).toEqual([other[0].id]);
    });

    it("treats following on the first occurrence as all", async () => {
      const created = await aSeries();

      expect(await deleteEvent(created[0].id, "following")).toHaveLength(6);
      expect(repositories.calendar.rows).toEqual([]);
    });

    it("deletes a one-off by any scope", async () => {
      const [only] = await createEvent(newEvent(), now);

      expect(await deleteEvent(only.id, "all")).toEqual([only.id]);
    });

    it("answers another family's event, or none, with a 404 and deletes nothing", async () => {
      const foreign = repositories.calendar.seed({ familyId: otherFamilyId });

      for (const scope of ["this", "following", "all"] as const) {
        await expect(deleteEvent(foreign.id, scope)).rejects.toMatchObject({ status: 404, message: EVENT_NOT_FOUND_MESSAGE });
        await expect(deleteEvent("40000000-0000-4000-8000-000000000999", scope)).rejects.toMatchObject({ status: 404 });
      }
      expect(repositories.calendar.rows).toEqual([foreign]);
    });
  });
});
