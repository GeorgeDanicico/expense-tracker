import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import type { FakeCalendarRow } from "@/test/fakes/calendar";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import { asKid, asLoner, asOutsider, asParent, kidMember, otherFamilyMemberId, secondParentMember } from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE, GET, PATCH } from "@/app/api/calendar/events/[id]/route";
import { POST } from "@/app/api/calendar/events/route";

const missingId = "90000000-0000-4000-8000-000000000404";
const parentMemberId = "60000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;
/** A one-off event of the shared family, 3 November 2026, 09:00 to 10:00 in Bucharest. */
let swim: FakeCalendarRow;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
  swim = repositories.calendar.seed({ title: "Swimming" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function read(id: string) {
  return callRoute(GET, { url: `/api/calendar/events/${id}`, params: { id } });
}

function edit(id: string, body: unknown) {
  return callRoute(PATCH, { method: "PATCH", body, params: { id } });
}

function remove(id: string, query = "") {
  return callRoute(DELETE, { method: "DELETE", url: `/api/calendar/events/${id}${query}`, params: { id } });
}

/** A weekly series of 6 from 3 November 2026, 09:00 to 10:00, through the add route; the events by series index. */
async function sixWeeks(): Promise<FakeCalendarRow[]> {
  const response = await callRoute(POST, {
    method: "POST",
    url: "/api/calendar/events",
    body: {
      title: "Piano",
      startDate: "2026-11-03",
      startTime: "09:00",
      endTime: "10:00",
      attendeeMemberIds: [parentMemberId],
      repeat: { kind: "weekly", count: 6 },
    },
  });
  expect(response.status).toBe(201);
  return repositories.calendar.rows
    .filter((row) => row.title === "Piano")
    .toSorted((a, b) => a.seriesIndex - b.seriesIndex);
}

const titles = (rows: readonly FakeCalendarRow[]) => rows.map((row) => row.title);
const starts = (rows: readonly FakeCalendarRow[]) => rows.map((row) => row.startsAt.slice(0, 16));

describe("GET /api/calendar/events/[id]", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await read(swim.id)).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.calendar.calls).toEqual([]);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await read(swim.id)).status).toBe(401);
  });

  it("returns the event with its attendees and series length", async () => {
    const [first, , third] = await sixWeeks();

    const response = await read(third.id);

    expect(response.status).toBe(200);
    expect(response.body.event).toMatchObject({
      id: third.id,
      seriesId: first.seriesId,
      seriesIndex: 3,
      seriesLength: 6,
      seriesRepeat: "weekly",
      title: "Piano",
      attendees: [{ memberId: parentMemberId, name: "owner" }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("lets a kid read a parent's event", async () => {
    asKid(repositories);

    expect(await read(swim.id)).toMatchObject({ status: 200, body: { event: { id: swim.id, seriesLength: 1 } } });
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect(await read("not-a-uuid")).toMatchObject({ status: 400, body: { error: "Invalid event identifier." } });
  });

  it("answers 404 to an event that doesn't exist", async () => {
    expect(await read(missingId)).toMatchObject({ status: 404, body: { error: "Event not found." } });
  });

  it("answers 404 to another family's member", async () => {
    asOutsider(repositories);

    expect((await read(swim.id)).status).toBe(404);
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await read(swim.id)).status).toBe(404);
  });
});

describe("PATCH /api/calendar/events/[id]", () => {
  it("answers 404 without saving while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await edit(swim.id, { title: "Changed" })).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(swim.title).toBe("Swimming");
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await edit(swim.id, { title: "Changed" })).status).toBe(401);
    expect(swim.title).toBe("Swimming");
  });

  it("edits the event and returns the changed events", async () => {
    const response = await edit(swim.id, {
      title: "Swimming gala",
      notes: "Bring a towel",
      location: "Pool",
      startDate: "2026-11-04",
      endTime: "11:00",
      attendeeMemberIds: [parentMemberId, secondParentMember.memberId],
    });

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: swim.id,
      title: "Swimming gala",
      notes: "Bring a towel",
      location: "Pool",
      startsAt: "2026-11-04T07:00:00.000Z",
      endsAt: "2026-11-04T09:00:00.000Z",
    });
    expect(response.body.events[0].attendees.map((attendee: { memberId: string }) => attendee.memberId).sort())
      .toEqual([parentMemberId, secondParentMember.memberId].sort());
  });

  it("lets a kid edit a parent's event", async () => {
    asKid(repositories);

    const response = await edit(swim.id, { title: "Swimming with Ana", attendeeMemberIds: [kidMember.memberId] });

    expect(response.status).toBe(200);
    expect(swim).toMatchObject({ title: "Swimming with Ana", memberIds: [kidMember.memberId] });
  });

  it("changes only the opened occurrence of a series with scope this, which is the default", async () => {
    const series = await sixWeeks();

    const response = await edit(series[2].id, { title: "Piano recital", startDate: "2026-11-18" });

    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([series[2].id]);
    expect(titles(series)).toEqual(["Piano", "Piano", "Piano recital", "Piano", "Piano", "Piano"]);
    expect(starts(series)).toEqual([
      "2026-11-03T07:00", "2026-11-10T07:00", "2026-11-18T07:00", "2026-11-24T07:00", "2026-12-01T07:00", "2026-12-08T07:00",
    ]);
  });

  it("changes the opened occurrence and the later ones with scope following", async () => {
    const series = await sixWeeks();

    const response = await edit(series[2].id, { scope: "following", title: "Piano duet", startTime: "10:00", endTime: "11:00" });

    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { seriesIndex: number }) => event.seriesIndex)).toEqual([3, 4, 5, 6]);
    expect(titles(series)).toEqual(["Piano", "Piano", "Piano duet", "Piano duet", "Piano duet", "Piano duet"]);
    expect(starts(series)).toEqual([
      "2026-11-03T07:00", "2026-11-10T07:00", "2026-11-17T08:00", "2026-11-24T08:00", "2026-12-01T08:00", "2026-12-08T08:00",
    ]);
  });

  it("changes the whole series with scope all, from any occurrence", async () => {
    const series = await sixWeeks();

    const response = await edit(series[4].id, { scope: "all", title: "Piano lessons", location: "Music school" });

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(6);
    expect(titles(series)).toEqual(Array(6).fill("Piano lessons"));
    expect(series.map((row) => row.location)).toEqual(Array(6).fill("Music school"));
    expect(starts(series)).toEqual([
      "2026-11-03T07:00", "2026-11-10T07:00", "2026-11-17T07:00", "2026-11-24T07:00", "2026-12-01T07:00", "2026-12-08T07:00",
    ]);
  });

  it("answers 422 to a bad scope", async () => {
    const response = await edit(swim.id, { scope: "some", title: "Changed" });

    expect(response.status).toBe(422);
    expect(Object.keys(response.body.fieldErrors)).toEqual(["scope"]);
    expect(swim.title).toBe("Swimming");
  });

  it.each([
    ["an empty change", {}],
    ["only a scope", { scope: "all" }],
    ["a repeat, which can't change", { repeat: { kind: "daily", count: 3 } }],
    ["a blank title", { title: "  " }],
    ["no attendees", { attendeeMemberIds: [] }],
    ["an end date before the start date", { startDate: "2026-11-05", endDate: "2026-11-04" }],
  ])("answers 422 to %s", async (_label, body) => {
    expect((await edit(swim.id, body)).status).toBe(422);
    expect(swim.title).toBe("Swimming");
  });

  it("answers 422 to an end before the start in the stored event", async () => {
    const response = await edit(swim.id, { endTime: "08:00" });

    expect(response.status).toBe(422);
    expect(swim.endsAt).toBe("2026-11-03T08:00:00.000Z");
  });

  it("answers 422 to an attendee from another family", async () => {
    const response = await edit(swim.id, { attendeeMemberIds: [otherFamilyMemberId] });

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { attendeeMemberIds: [expect.any(String)] } } });
    expect(swim.memberIds).toEqual([parentMemberId]);
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect(await edit("not-a-uuid", { title: "Changed" })).toMatchObject({ status: 400, body: { error: "Invalid event identifier." } });
  });

  it("answers 404 to an event that doesn't exist", async () => {
    expect(await edit(missingId, { title: "Changed" })).toMatchObject({ status: 404, body: { error: "Event not found." } });
  });

  it("answers 404 to another family's member, in every scope", async () => {
    const series = await sixWeeks();
    asOutsider(repositories);

    for (const scope of ["this", "following", "all"]) {
      expect((await edit(series[1].id, { scope, title: "Mine now" })).status).toBe(404);
    }
    expect(titles(series)).toEqual(Array(6).fill("Piano"));
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await edit(swim.id, { title: "Mine now" })).status).toBe(404);
    expect(swim.title).toBe("Swimming");
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.calendar, "update").mockRejectedValue(new Error("private database failure"));

    expect(await edit(swim.id, { title: "Changed" })).toMatchObject({ status: 500, body: { error: "Unable to save the event." } });
  });
});

describe("DELETE /api/calendar/events/[id]", () => {
  it("answers 404 without deleting while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await remove(swim.id)).status).toBe(404);
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await remove(swim.id)).status).toBe(401);
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("deletes an event and returns its id", async () => {
    expect(await remove(swim.id)).toMatchObject({ status: 200, body: { deletedIds: [swim.id] } });
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("lets a kid delete a parent's event", async () => {
    asKid(repositories);

    expect((await remove(swim.id, "?scope=all")).status).toBe(200);
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("deletes only the opened occurrence with scope this, which is the default", async () => {
    const series = await sixWeeks();

    const response = await remove(series[2].id);

    expect(response.body.deletedIds).toEqual([series[2].id]);
    expect(await remove(series[3].id, "?scope=this")).toMatchObject({ status: 200, body: { deletedIds: [series[3].id] } });
    expect(repositories.calendar.rows.filter((row) => row.title === "Piano").map((row) => row.seriesIndex)).toEqual([1, 2, 5, 6]);
  });

  it("deletes the opened occurrence and the later ones with scope following", async () => {
    const series = await sixWeeks();

    const response = await remove(series[2].id, "?scope=following");

    expect(response.body.deletedIds).toEqual([series[2].id, series[3].id, series[4].id, series[5].id]);
    expect(repositories.calendar.rows.filter((row) => row.title === "Piano").map((row) => row.seriesIndex)).toEqual([1, 2]);
    expect(repositories.calendar.rows).toContain(swim);
  });

  it("deletes the whole series with scope all, and nothing else", async () => {
    const series = await sixWeeks();

    const response = await remove(series[4].id, "?scope=all");

    expect(response.body.deletedIds).toEqual(series.map((row) => row.id));
    expect(repositories.calendar.rows).toEqual([swim]);
  });

  it("answers 422 to a bad scope", async () => {
    const response = await remove(swim.id, "?scope=everything");

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { scope: [expect.any(String)] } } });
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("answers 400 to an identifier that isn't a UUID", async () => {
    expect(await remove("not-a-uuid")).toMatchObject({ status: 400, body: { error: "Invalid event identifier." } });
  });

  it("answers 404 to an event that doesn't exist", async () => {
    expect(await remove(missingId)).toMatchObject({ status: 404, body: { error: "Event not found." } });
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("answers 404 to another family's member, in every scope", async () => {
    const series = await sixWeeks();
    asOutsider(repositories);

    for (const scope of ["this", "following", "all"]) {
      expect((await remove(series[1].id, `?scope=${scope}`)).status).toBe(404);
    }
    expect(repositories.calendar.rows).toHaveLength(7);
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await remove(swim.id)).status).toBe(404);
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.calendar, "delete").mockRejectedValue(new Error("private database failure"));

    expect(await remove(swim.id)).toMatchObject({ status: 500, body: { error: "Unable to delete the event." } });
  });
});
