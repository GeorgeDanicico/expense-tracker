import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute } from "@/test/route";
import {
  asKid,
  asLoner,
  asOutsider,
  asParent,
  kidMember,
  kidUser,
  otherFamilyMemberId,
  parentUser,
} from "@/test/todo-board";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET, POST } from "@/app/api/calendar/events/route";

const parentMemberId = "60000000-0000-4000-8000-000000000001";

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  asParent(repositories);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function list(query = "") {
  return callRoute(GET, { url: `/api/calendar/events${query}` });
}

function add(body: unknown) {
  return callRoute(POST, { method: "POST", url: "/api/calendar/events", body });
}

/** A new event on 3 November 2026 (09:00 to 10:00 in Bucharest, which is UTC+2). */
const newEvent = (fields: Record<string, unknown> = {}) => ({
  title: "Swimming",
  startDate: "2026-11-03",
  startTime: "09:00",
  endTime: "10:00",
  attendeeMemberIds: [parentMemberId],
  ...fields,
});

const NOVEMBER = "?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z";

describe("GET /api/calendar/events", () => {
  it("answers 404 without any query while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect(await list(NOVEMBER)).toMatchObject({ status: 404, body: { error: "Not found." } });
    expect(repositories.calendar.calls).toEqual([]);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await list(NOVEMBER)).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await list(NOVEMBER)).status).toBe(404);
  });

  it("returns the events overlapping the range by start, with attendees and series length", async () => {
    const later = repositories.calendar.seed({ title: "Dentist", startsAt: "2026-11-10T07:00:00.000Z", endsAt: "2026-11-10T08:00:00.000Z" });
    const first = repositories.calendar.seed({ memberIds: [kidMember.memberId] });
    repositories.calendar.seed({ title: "October", startsAt: "2026-10-03T07:00:00.000Z", endsAt: "2026-10-03T08:00:00.000Z" });
    // Starts before the range and ends inside it.
    const overlapping = repositories.calendar.seed({
      title: "Camp",
      startsAt: "2026-10-30T07:00:00.000Z",
      endsAt: "2026-11-02T07:00:00.000Z",
    });

    const response = await list(NOVEMBER);

    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([overlapping.id, first.id, later.id]);
    expect(response.body.events[1]).toMatchObject({
      seriesLength: 1,
      attendees: [{ memberId: kidMember.memberId, name: "Ana", color: 3, avatarUrl: "/api/avatars/kid/a.webp" }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("accepts timestamps with an offset", async () => {
    const event = repositories.calendar.seed();

    const response = await list("?from=2026-11-03T00:00:00%2B02:00&to=2026-11-04T00:00:00%2B02:00");

    expect(response.body.events.map((found: { id: string }) => found.id)).toEqual([event.id]);
  });

  it("lists only the events one member attends with member, for a kid as well", async () => {
    asKid(repositories);
    const kids = repositories.calendar.seed({ title: "Kids' swim", memberIds: [kidMember.memberId] });
    repositories.calendar.seed({ title: "Parents' dinner", memberIds: [parentMemberId] });

    const response = await list(`${NOVEMBER}&member=${kidMember.memberId}`);

    expect(response.status).toBe(200);
    expect(response.body.events.map((event: { id: string }) => event.id)).toEqual([kids.id]);
  });

  it("accepts a range of 92 days", async () => {
    expect((await list("?from=2026-11-01T00:00:00Z&to=2027-02-01T00:00:00Z")).status).toBe(200);
  });

  it("answers 422 to a range over 92 days", async () => {
    const response = await list("?from=2026-11-01T00:00:00Z&to=2027-02-05T00:00:00Z");

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { to: ["The range can cover at most 92 days."] } } });
  });

  it("answers 422 to a range that ends before it starts", async () => {
    const response = await list("?from=2026-12-01T00:00:00Z&to=2026-11-01T00:00:00Z");

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { to: ["The range must end after it starts."] } } });
  });

  it.each([
    ["no range", ""],
    ["no end", "?from=2026-11-01T00:00:00Z"],
    ["a date without a time", "?from=2026-11-01&to=2026-12-01"],
    ["words", "?from=today&to=tomorrow"],
  ])("answers 422 to %s", async (_label, query) => {
    const response = await list(query);

    expect(response.status).toBe(422);
    expect(Object.keys(response.body.fieldErrors).length).toBeGreaterThan(0);
  });

  it("answers 422 to a member that isn't a UUID", async () => {
    const response = await list(`${NOVEMBER}&member=everyone`);

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { member: ["Choose a member of your family."] } } });
  });

  it("never shows another family's events", async () => {
    repositories.calendar.seed({ title: "The Smiths' swim" });
    asOutsider(repositories);

    expect(await list(NOVEMBER)).toMatchObject({ status: 200, body: { events: [] } });
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.calendar, "listBetween").mockRejectedValue(new Error("private database failure"));

    expect(await list(NOVEMBER)).toMatchObject({ status: 500, body: { error: "Unable to load the calendar." } });
  });
});

describe("POST /api/calendar/events", () => {
  it("answers 404 without saving while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await add(newEvent())).status).toBe(404);
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("answers 401 to an anonymous caller", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await add(newEvent())).status).toBe(401);
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("answers 404 to a user with no family", async () => {
    asLoner(repositories);

    expect((await add(newEvent())).status).toBe(404);
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("adds a one-off event, created by the caller, with status 201", async () => {
    const response = await add(newEvent({ title: "  Swimming  ", location: "Pool" }));

    expect(response.status).toBe(201);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      title: "Swimming",
      notes: "",
      location: "Pool",
      allDay: false,
      startsAt: "2026-11-03T07:00:00.000Z",
      endsAt: "2026-11-03T08:00:00.000Z",
      timezone: "Europe/Bucharest",
      seriesIndex: 1,
      seriesLength: 1,
      seriesRepeat: "none",
      createdBy: parentUser.id,
      attendees: [{ memberId: parentMemberId }],
    });
    expect(repositories.calendar.rows).toHaveLength(1);
  });

  it("adds an all-day event over several days", async () => {
    const response = await add({
      title: "Holiday",
      allDay: true,
      startDate: "2026-12-26",
      endDate: "2026-12-28",
      attendeeMemberIds: [parentMemberId, kidMember.memberId],
    });

    expect(response.status).toBe(201);
    expect(response.body.events[0]).toMatchObject({
      allDay: true,
      startsAt: "2026-12-25T22:00:00.000Z",
      endsAt: "2026-12-28T22:00:00.000Z",
    });
    expect(response.body.events[0].attendees).toHaveLength(2);
  });

  it("adds a weekly series of 6 as 6 events by series index, all returned", async () => {
    const response = await add(newEvent({ repeat: { kind: "weekly", count: 6 } }));

    expect(response.status).toBe(201);
    expect(response.body.events.map((event: { seriesIndex: number }) => event.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(response.body.events.map((event: { startsAt: string }) => event.startsAt.slice(0, 10))).toEqual([
      "2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08",
    ]);
    expect(new Set(response.body.events.map((event: { seriesId: string }) => event.seriesId)).size).toBe(1);
    expect(response.body.events[0]).toMatchObject({ seriesLength: 6, seriesRepeat: "weekly" });
    expect(repositories.calendar.rows).toHaveLength(6);
  });

  it("lets a kid add an event for the whole family", async () => {
    asKid(repositories);

    const response = await add(newEvent({ attendeeMemberIds: [parentMemberId, kidMember.memberId] }));

    expect(response.status).toBe(201);
    expect(response.body.events[0]).toMatchObject({ createdBy: kidUser.id });
    expect(response.body.events[0].attendees).toHaveLength(2);
  });

  it("answers 422 to an attendee from another family", async () => {
    const response = await add(newEvent({ attendeeMemberIds: [otherFamilyMemberId] }));

    expect(response).toMatchObject({ status: 422, body: { fieldErrors: { attendeeMemberIds: [expect.any(String)] } } });
    expect(repositories.calendar.rows).toEqual([]);
  });

  it.each([
    ["no attendees", newEvent({ attendeeMemberIds: [] }), "attendeeMemberIds"],
    ["no attendees field", { ...newEvent(), attendeeMemberIds: undefined }, "attendeeMemberIds"],
    ["a repeat of 11", newEvent({ repeat: { kind: "daily", count: 11 } }), "repeat"],
    ["a repeat of 1", newEvent({ repeat: { kind: "weekly", count: 1 } }), "repeat"],
    ["an end before the start", newEvent({ startTime: "10:00", endTime: "09:00" }), "endTime"],
    ["an end date before the start date", newEvent({ endDate: "2026-11-02" }), "endTime"],
    ["a blank title", newEvent({ title: " " }), "title"],
    ["a timed event without times", newEvent({ startTime: null, endTime: null }), "startTime"],
  ])("answers 422 to %s", async (_label, body, field) => {
    const response = await add(body);

    expect(response.status).toBe(422);
    expect(Object.keys(response.body.fieldErrors)).toContain(field);
    expect(repositories.calendar.rows).toEqual([]);
  });

  it("answers 422 to a body that isn't JSON", async () => {
    expect((await add("not json")).status).toBe(422);
  });

  it("hides a storage failure behind a generic message", async () => {
    vi.spyOn(repositories.calendar, "create").mockRejectedValue(new Error("private database failure"));

    expect(await add(newEvent())).toMatchObject({ status: 500, body: { error: "Unable to save the event." } });
  });
});
