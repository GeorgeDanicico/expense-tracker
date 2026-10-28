import { beforeEach, describe, expect, it } from "vitest";

import type { NewCalendarRow } from "@/lib/family-calendar/repository";
import { aFamily, aFamilyMember, aParent } from "@/test/builders";

import { FakeCalendarFeedRepository, FakeCalendarRepository } from "./calendar";
import { FakeFamilyRepository } from "./family";

const otherFamilyId = "70000000-0000-4000-8000-000000000999";
const kid = aFamilyMember({ displayName: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" });
const parentId = aParent().memberId;

const row = (seriesIndex: number): NewCalendarRow => ({
  seriesIndex,
  seriesRepeat: "weekly",
  title: "Swimming",
  notes: "",
  location: "",
  allDay: false,
  startsAt: `2026-11-${String(3 + 7 * (seriesIndex - 1)).padStart(2, "0")}T07:00:00.000Z`,
  endsAt: `2026-11-${String(3 + 7 * (seriesIndex - 1)).padStart(2, "0")}T08:00:00.000Z`,
  timezone: "Europe/Bucharest",
  notifyAt: null,
});

describe("FakeCalendarRepository", () => {
  let family: FakeFamilyRepository;
  let calendar: FakeCalendarRepository;

  beforeEach(() => {
    family = new FakeFamilyRepository();
    family.membership = aParent();
    family.family = { ...aFamily(), members: [...aFamily().members, kid] };
    calendar = new FakeCalendarRepository(family);
  });

  it("creates a series in the caller's family, by index, with attendees joined and the length counted", async () => {
    const created = await calendar.create([row(2), row(1)], [kid.memberId, parentId]);

    expect(created.map((event) => event.seriesIndex)).toEqual([1, 2]);
    expect(created[0]).toMatchObject({
      seriesLength: 2,
      createdBy: family.caller.userId,
      attendees: [
        { memberId: parentId, name: "owner", color: null, avatarUrl: null },
        { memberId: kid.memberId, name: "Ana", color: 3, avatarUrl: "/api/avatars/a/b" },
      ],
    });
    expect(new Set(created.map((event) => event.seriesId)).size).toBe(1);
    expect(calendar.rows.every((stored) => stored.familyId === aParent().familyId)).toBe(true);
  });

  it("refuses an attendee outside the family (422) and a caller without one (404), storing nothing", async () => {
    await expect(calendar.create([row(1)], ["60000000-0000-4000-8000-000000000999"])).rejects.toMatchObject({ status: 422 });
    expect(calendar.rows).toEqual([]);

    family.membership = null;
    await expect(calendar.create([row(1)], [parentId])).rejects.toMatchObject({ status: 404 });
    await expect(calendar.listBetween("2026-11-01T00:00:00.000Z", "2026-12-01T00:00:00.000Z")).rejects.toMatchObject({ status: 404 });
  });

  it("lists the overlap of a range for the caller's family only, by start", async () => {
    const late = calendar.seed({ startsAt: "2026-11-05T07:00:00.000Z", endsAt: "2026-11-05T08:00:00.000Z" });
    const early = calendar.seed({ startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z" });
    calendar.seed({ startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z", familyId: otherFamilyId });
    // Ends as the range starts.
    calendar.seed({ startsAt: "2026-11-02T23:00:00.000Z", endsAt: "2026-11-03T00:00:00.000Z" });

    const listed = await calendar.listBetween("2026-11-03T00:00:00.000Z", "2026-11-06T00:00:00.000Z");

    expect(listed.map((event) => event.id)).toEqual([early.id, late.id]);
  });

  it("treats another family's event as missing", async () => {
    const foreign = calendar.seed({ familyId: otherFamilyId });

    expect(await calendar.get(foreign.id)).toBeNull();
    expect(await calendar.listSeries(foreign.seriesId)).toEqual([]);
    await expect(calendar.update([{ id: foreign.id, title: "Mine now" }])).rejects.toMatchObject({ status: 404 });
    expect(await calendar.delete([foreign.id])).toEqual([]);
    expect(calendar.rows).toEqual([foreign]);
  });

  it("updates all or nothing, applying only the given fields and replacing attendees", async () => {
    const [first, second] = await calendar.create([row(1), row(2)], [parentId]);

    await expect(calendar.update([{ id: first.id, title: "Diving" }, { id: "missing" }])).rejects.toMatchObject({ status: 404 });
    expect(calendar.rows[0].title).toBe("Swimming");

    const updated = await calendar.update(
      [{ id: second.id, title: "Diving", notifyAt: "2026-11-10T06:30:00.000Z", notifiedAt: null }, { id: first.id }],
      [kid.memberId],
    );

    expect(updated.map((event) => [event.seriesIndex, event.title])).toEqual([[1, "Swimming"], [2, "Diving"]]);
    expect(updated.every((event) => event.attendees.length === 1 && event.attendees[0].memberId === kid.memberId)).toBe(true);
    expect(calendar.rows[1]).toMatchObject({ notifyAt: "2026-11-10T06:30:00.000Z", notifiedAt: null });
  });

  it("deletes the events that exist and returns their ids", async () => {
    const [first, second] = await calendar.create([row(1), row(2)], [parentId]);

    expect(await calendar.delete([second.id, "missing"])).toEqual([second.id]);
    expect((await calendar.get(first.id))?.seriesLength).toBe(1);
  });
});

describe("FakeCalendarFeedRepository", () => {
  const hash = "a".repeat(64);
  const newHash = "b".repeat(64);
  let feeds: FakeCalendarFeedRepository;

  beforeEach(() => {
    feeds = new FakeCalendarFeedRepository();
  });

  it("keeps one live link: creating revokes the previous one", async () => {
    expect(await feeds.get()).toBeNull();
    await feeds.create(hash);
    const second = await feeds.create(newHash);

    expect(await feeds.get()).toEqual(second);
    expect(await feeds.read(hash)).toBeNull();
    expect(await feeds.read(newHash)).toEqual({ familyName: null, events: [] });
  });

  it("revokes the live link and says whether there was one", async () => {
    await feeds.create(hash);

    expect(await feeds.revoke()).toBe(true);
    expect(await feeds.revoke()).toBe(false);
    expect(await feeds.get()).toBeNull();
    expect(await feeds.read(hash)).toBeNull();
  });

  it("answers a read with the contents set for its hash and records the fetch", async () => {
    await feeds.create(hash);
    feeds.contents.set(hash, { familyName: "The Smiths", events: [] });

    expect(await feeds.read(hash)).toEqual({ familyName: "The Smiths", events: [] });
    expect((await feeds.get())?.lastFetchedAt).not.toBeNull();
  });

  it("refuses a malformed hash", async () => {
    await expect(feeds.create("nope")).rejects.toThrow();
  });
});
