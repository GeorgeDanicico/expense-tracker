import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { createMcpServer } from "@/lib/mcp/server";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const PARENT_ID = "60000000-0000-4000-8000-000000000001";
const ANA_ID = "60000000-0000-4000-8000-000000000002";
const OTHER_FAMILY = "70000000-0000-4000-8000-000000000009";
const MISSING = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ userId: "owner", email: "owner@example.com" });
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await (await connect()).callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError, text, body: text.startsWith("{") ? JSON.parse(text) : {} };
}

/** A timed event on 3 November 2026: 09:00 to 10:00 in Bucharest (UTC+2). */
const swimming = { title: "Swimming", startDate: "2026-11-03", startTime: "09:00", endTime: "10:00" };

describe("MCP calendar tools", () => {
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories = resetFakeRepositories();
    const family = aFamily();
    family.members.push(aFamilyMember({ displayName: "Ana", username: "ana" }));
    repositories.family.family = family;
    repositories.family.membership = aParent();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const calendar = () => repositories.calendar;
  const titles = (body: { events: { title: string }[] }) => body.events.map((event) => event.title);

  describe("list_events", () => {
    it("lists the family's events in time order with attendees by name and the times as the form states them", async () => {
      calendar().seed({ title: "Dentist", startsAt: "2026-11-04T14:00:00.000Z", endsAt: "2026-11-04T15:30:00.000Z", memberIds: [ANA_ID], location: "Clinic", notes: "Bring the card" });
      calendar().seed({ title: "Swimming", startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z", memberIds: [PARENT_ID, ANA_ID] });

      const { body, isError } = await call("list_events", { from: "2026-11-01", to: "2026-11-30" });

      expect(isError).toBeFalsy();
      expect(body.events).toEqual([
        {
          id: expect.any(String), title: "Swimming", allDay: false, startDate: "2026-11-03", startTime: "09:00",
          endDate: "2026-11-03", endTime: "10:00", attendees: ["owner", "Ana"], location: "", notes: "", repeat: null,
        },
        expect.objectContaining({ title: "Dentist", startTime: "16:00", endTime: "17:30", attendees: ["Ana"], location: "Clinic", notes: "Bring the card" }),
      ]);
    });

    it("includes the whole of both end days, on the Bucharest clock", async () => {
      // 23:30 local on the 3rd is 21:30Z; 00:30 local on the 5th is 22:30Z on the 4th.
      calendar().seed({ title: "Late", startsAt: "2026-11-03T21:30:00.000Z", endsAt: "2026-11-03T21:45:00.000Z" });
      calendar().seed({ title: "Early", startsAt: "2026-11-04T22:30:00.000Z", endsAt: "2026-11-04T22:45:00.000Z" });
      calendar().seed({ title: "Too early", startsAt: "2026-11-02T21:30:00.000Z", endsAt: "2026-11-02T21:45:00.000Z" });
      calendar().seed({ title: "Too late", startsAt: "2026-11-05T22:30:00.000Z", endsAt: "2026-11-05T22:45:00.000Z" });

      expect(titles((await call("list_events", { from: "2026-11-03", to: "2026-11-05" })).body)).toEqual(["Late", "Early"]);
      expect(titles((await call("list_events", { from: "2026-11-03" })).body)).toEqual(["Late"]);
    });

    it("shows an all-day event's last day, included, and a repeat's place in its series", async () => {
      calendar().seed({ title: "Ski weekend", allDay: true, startsAt: "2026-11-06T22:00:00.000Z", endsAt: "2026-11-08T22:00:00.000Z" });
      calendar().seed({ title: "Piano", seriesRepeat: "weekly", seriesId: "s1", seriesIndex: 2, startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z" });
      calendar().seed({ title: "Piano", seriesRepeat: "weekly", seriesId: "s1", seriesIndex: 1, startsAt: "2026-10-27T07:00:00.000Z", endsAt: "2026-10-27T08:00:00.000Z" });

      const { body } = await call("list_events", { from: "2026-11-01", to: "2026-11-30" });

      expect(body.events[0]).toMatchObject({ title: "Piano", repeat: { kind: "weekly", occurrence: 2, of: 2 } });
      expect(body.events[1]).toMatchObject({
        title: "Ski weekend", allDay: true, startDate: "2026-11-07", startTime: null, endDate: "2026-11-08", endTime: null, repeat: null,
      });
    });

    it("filters by member name (any case) and me", async () => {
      calendar().seed({ title: "Ana's", memberIds: [ANA_ID] });
      calendar().seed({ title: "Mine", memberIds: [PARENT_ID] });
      calendar().seed({ title: "Both", memberIds: [PARENT_ID, ANA_ID] });
      const range = { from: "2026-11-01", to: "2026-11-30" };

      expect(titles((await call("list_events", { ...range, member: "ANA" })).body).sort()).toEqual(["Ana's", "Both"]);
      expect(titles((await call("list_events", { ...range, member: "me" })).body).sort()).toEqual(["Both", "Mine"]);
    });

    it("names the valid members for an unknown one", async () => {
      const { body, isError } = await call("list_events", { from: "2026-11-01", member: "Bob" });

      expect(isError).toBe(true);
      expect(body.error).toBe("No family member is called \"Bob\". Use one of: \"owner\", \"Ana\", \"me\".");
    });

    it("limits a range to 92 days and checks its dates", async () => {
      const long = await call("list_events", { from: "2026-11-01", to: "2027-03-01" });
      expect(long.isError).toBe(true);
      expect(long.body.error).toBe("The range can cover at most 92 days.");

      expect((await call("list_events", { from: "2026-11-01", to: "2027-01-31" })).isError).toBeFalsy();
      expect((await call("list_events", { from: "2026-11-30", to: "2026-11-01" })).isError).toBe(true);
      expect((await call("list_events", { from: "next week" })).isError).toBe(true);
    });

    it("only ever shows the caller's own family's events", async () => {
      calendar().seed({ title: "Ours" });
      calendar().seed({ title: "Theirs", familyId: OTHER_FAMILY });

      expect(titles((await call("list_events", { from: "2026-11-01", to: "2026-11-30" })).body)).toEqual(["Ours"]);
    });

    it("shows a kid every event, a parent's included: the calendar has no private events", async () => {
      repositories.family.membership = aKid();
      calendar().seed({ title: "Parent's appointment", memberIds: [PARENT_ID] });

      expect(titles((await call("list_events", { from: "2026-11-01", to: "2026-11-30" })).body)).toEqual(["Parent's appointment"]);
    });
  });

  describe("add_event", () => {
    it("adds a timed event for the caller by default, in Bucharest time", async () => {
      const { body, isError } = await call("add_event", { ...swimming, location: "Pool", notes: "Bring a towel" });

      expect(isError).toBeFalsy();
      expect(body.events).toEqual([expect.objectContaining({
        title: "Swimming", startDate: "2026-11-03", startTime: "09:00", endDate: "2026-11-03", endTime: "10:00",
        attendees: ["owner"], location: "Pool", notes: "Bring a towel", repeat: null,
      })]);
      expect(calendar().rows).toHaveLength(1);
      expect(calendar().rows[0]).toMatchObject({
        startsAt: "2026-11-03T07:00:00.000Z", endsAt: "2026-11-03T08:00:00.000Z", memberIds: [PARENT_ID], createdBy: expect.any(String),
      });
    });

    it("takes attendees by name, me or everyone", async () => {
      await call("add_event", { ...swimming, title: "Ana only", attendees: ["ana"] });
      await call("add_event", { ...swimming, title: "Us two", attendees: ["me", "Ana", "ANA"] });
      await call("add_event", { ...swimming, title: "All", attendees: ["Everyone"] });

      expect(calendar().rows.map((row) => [row.title, row.memberIds.toSorted()])).toEqual([
        ["Ana only", [ANA_ID]],
        ["Us two", [PARENT_ID, ANA_ID].toSorted()],
        ["All", [PARENT_ID, ANA_ID].toSorted()],
      ]);
    });

    it("adds an all-day event over several days", async () => {
      const { body } = await call("add_event", { title: "Ski weekend", allDay: true, startDate: "2026-11-07", endDate: "2026-11-08" });

      expect(body.events[0]).toMatchObject({ allDay: true, startDate: "2026-11-07", endDate: "2026-11-08", startTime: null });
      expect(calendar().rows[0]).toMatchObject({ startsAt: "2026-11-06T22:00:00.000Z", endsAt: "2026-11-08T22:00:00.000Z" });
    });

    it("adds every occurrence of a weekly repeat at the same local time across the clock change", async () => {
      const { body } = await call("add_event", { ...swimming, startDate: "2026-10-20", repeat: "weekly", repeatCount: 3 });

      expect(body.events.map((event: { startDate: string; startTime: string; repeat: unknown }) => [event.startDate, event.startTime, event.repeat])).toEqual([
        ["2026-10-20", "09:00", { kind: "weekly", occurrence: 1, of: 3 }],
        ["2026-10-27", "09:00", { kind: "weekly", occurrence: 2, of: 3 }],
        ["2026-11-03", "09:00", { kind: "weekly", occurrence: 3, of: 3 }],
      ]);
      // 20 Oct is still summer time (UTC+3), the others winter time (UTC+2).
      expect(calendar().rows.map((row) => row.startsAt)).toEqual([
        "2026-10-20T06:00:00.000Z", "2026-10-27T07:00:00.000Z", "2026-11-03T07:00:00.000Z",
      ]);
    });

    it("works out when to notify, so an added event notifies like one added in the app", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));

      await call("add_event", swimming);

      expect(calendar().rows[0].notifyAt).toBe("2026-11-03T06:30:00.000Z");
    });

    it.each([
      ["a timed event without times", { title: "Swimming", startDate: "2026-11-03" }, "startTime"],
      ["an end before the start", { ...swimming, endTime: "08:00" }, "endTime"],
      ["a repeat without a count", { ...swimming, repeat: "daily" }, "repeat"],
      ["a repeat of 11", { ...swimming, repeat: "daily", repeatCount: 11 }, "repeat"],
      ["a bad date", { ...swimming, startDate: "2026-02-30" }, "startDate"],
      ["an empty title", { ...swimming, title: "  " }, "title"],
    ])("refuses %s, with a field error and nothing saved", async (_name, args, field) => {
      const { isError, text } = await call("add_event", args);

      // Either the tool's own field errors, or the MCP SDK's message for a malformed argument.
      expect(isError).toBe(true);
      expect(text).toContain(field);
      expect(calendar().rows).toEqual([]);
    });

    it("refuses an unknown attendee, naming the valid ones", async () => {
      const { body, isError } = await call("add_event", { ...swimming, attendees: ["Bob"] });

      expect(isError).toBe(true);
      expect(body.error).toContain("No family member is called \"Bob\"");
      expect(body.fieldErrors).toHaveProperty("attendees");
      expect(calendar().rows).toEqual([]);
    });

    it("accepts no member ids, so nobody outside the family can be added", async () => {
      const client = await connect();
      const addEvent = (await client.listTools()).tools.find((tool) => tool.name === "add_event");

      expect(Object.keys(addEvent?.inputSchema.properties ?? {})).not.toContain("attendeeMemberIds");
      expect(Object.keys(addEvent?.inputSchema.properties ?? {})).toContain("attendees");
    });
  });

  describe("update_event", () => {
    /** A weekly series of four, 3 to 24 November, 09:00 local, for the caller. */
    async function series() {
      const { body } = await call("add_event", { ...swimming, repeat: "weekly", repeatCount: 4 });
      return body.events as { id: string }[];
    }
    const starts = () => calendar().rows.toSorted((a, b) => a.seriesIndex - b.seriesIndex).map((row) => `${row.startsAt.slice(0, 10)} ${row.startsAt.slice(11, 16)}`);

    it("changes only this event by default", async () => {
      const [first, second] = await series();

      const { body, isError } = await call("update_event", { id: second.id, title: "Lessons", startTime: "10:00", endTime: "11:00" });

      expect(isError).toBeFalsy();
      expect(body.events).toEqual([expect.objectContaining({ id: second.id, title: "Lessons", startTime: "10:00", endTime: "11:00" })]);
      expect(calendar().rows.find((row) => row.id === first.id)).toMatchObject({ title: "Swimming" });
      expect(starts()).toEqual(["2026-11-03 07:00", "2026-11-10 08:00", "2026-11-17 07:00", "2026-11-24 07:00"]);
    });

    it("moves this and the following events, leaving the earlier ones", async () => {
      const [, second] = await series();

      const { body } = await call("update_event", { id: second.id, scope: "following", startTime: "18:00", endTime: "19:00" });

      expect(body.events).toHaveLength(3);
      expect(starts()).toEqual(["2026-11-03 07:00", "2026-11-10 16:00", "2026-11-17 16:00", "2026-11-24 16:00"]);
    });

    it("shifts every occurrence by the same number of days for all", async () => {
      const [, , third] = await series();

      await call("update_event", { id: third.id, scope: "all", startDate: "2026-11-18" });

      expect(starts()).toEqual(["2026-11-04 07:00", "2026-11-11 07:00", "2026-11-18 07:00", "2026-11-25 07:00"]);
    });

    it("replaces the attendees by name", async () => {
      const [first] = await series();

      const { body } = await call("update_event", { id: first.id, scope: "all", attendees: ["Ana"] });

      expect(body.events.map((event: { attendees: string[] }) => event.attendees)).toEqual([["Ana"], ["Ana"], ["Ana"], ["Ana"]]);
    });

    it("clears a notification that was already sent when the start moves", async () => {
      const [first] = await series();
      calendar().rows[0].notifiedAt = "2026-11-03T06:30:00.000Z";

      await call("update_event", { id: first.id, startTime: "10:00", endTime: "11:00" });

      expect(calendar().rows[0].notifiedAt).toBeNull();
    });

    it("lets a kid change a parent's event: every member edits every event", async () => {
      const parentsEvent = calendar().seed({ title: "Parent's", memberIds: [PARENT_ID] });
      repositories.family.membership = aKid();

      const { isError, body } = await call("update_event", { id: parentsEvent.id, title: "Changed" });

      expect(isError).toBeFalsy();
      expect(body.events[0].title).toBe("Changed");
    });

    it.each([
      ["nothing to change", {}],
      ["a changed repeat", { repeat: "daily" }],
      ["a member id", { attendeeMemberIds: [PARENT_ID] }],
    ])("refuses %s", async (_name, extra) => {
      const event = calendar().seed();

      const { isError } = await call("update_event", { id: event.id, ...extra });

      expect(isError).toBe(true);
    });

    it("refuses a change that would end the event before it starts", async () => {
      const event = calendar().seed();

      const { isError, body } = await call("update_event", { id: event.id, endTime: "07:00" });

      expect(isError).toBe(true);
      expect(body.fieldErrors).toHaveProperty("endTime");
    });

    it("answers not found for a missing event and for another family's, and changes nothing", async () => {
      const theirs = calendar().seed({ title: "Theirs", familyId: OTHER_FAMILY });

      for (const id of [MISSING, theirs.id]) {
        const { body, isError } = await call("update_event", { id, title: "Mine now", scope: "all" });
        expect(isError).toBe(true);
        expect(body.error).toBe("Event not found.");
      }
      expect(calendar().rows[0]).toMatchObject({ title: "Theirs" });
    });
  });

  describe("delete_event", () => {
    async function series() {
      const { body } = await call("add_event", { ...swimming, repeat: "daily", repeatCount: 4 });
      return body.events as { id: string }[];
    }
    const remaining = () => calendar().rows.map((row) => row.seriesIndex).toSorted();

    it("deletes this event by default", async () => {
      const [, second] = await series();

      const { body, isError } = await call("delete_event", { id: second.id });

      expect(isError).toBeFalsy();
      expect(body).toEqual({ deleted: true, deletedIds: [second.id] });
      expect(remaining()).toEqual([1, 3, 4]);
    });

    it("deletes this and the following events, or the whole series", async () => {
      const [, second] = await series();

      expect((await call("delete_event", { id: second.id, scope: "following" })).body.deletedIds).toHaveLength(3);
      expect(remaining()).toEqual([1]);

      expect((await call("delete_event", { id: calendar().rows[0].id, scope: "all" })).body.deletedIds).toHaveLength(1);
      expect(calendar().rows).toEqual([]);
    });

    it("answers not found for a missing event and for another family's, which stays", async () => {
      const theirs = calendar().seed({ title: "Theirs", familyId: OTHER_FAMILY });

      for (const id of [MISSING, theirs.id]) {
        const { body, isError } = await call("delete_event", { id, scope: "all" });
        expect(isError).toBe(true);
        expect(body.error).toBe("Event not found.");
      }
      expect(calendar().rows).toHaveLength(1);
    });

    it("is marked destructive, and the others aren't", async () => {
      const tools = (await (await connect()).listTools()).tools;
      const annotations = (name: string) => tools.find((tool) => tool.name === name)?.annotations;

      expect(annotations("delete_event")).toMatchObject({ destructiveHint: true });
      expect(annotations("list_events")).toMatchObject({ readOnlyHint: true });
      expect(annotations("add_event")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
      expect(annotations("update_event")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    });
  });

  it.each([
    ["list_events", { from: "2026-11-01" }],
    ["add_event", swimming],
    ["update_event", { id: MISSING, title: "x" }],
    ["delete_event", { id: MISSING }],
  ])("refuses %s for a caller without a family", async (name, args) => {
    repositories.family.membership = null;
    repositories.family.family = null;

    const { body, isError } = await call(name, args);

    expect(isError).toBe(true);
    expect(body.error).toBe("Join a family to use the calendar.");
  });

  it("has no calendar tools while the family flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    const names = (await (await connect()).listTools()).tools.map((tool) => tool.name);

    expect(names).not.toEqual(expect.arrayContaining(["list_events"]));
    expect(names.filter((name) => name.endsWith("_event") || name.endsWith("_events"))).toEqual([]);
  });

  it("adds the four calendar tools while the family flag is on", async () => {
    const names = (await (await connect()).listTools()).tools.map((tool) => tool.name);

    expect(names.filter((name) => name.endsWith("_event") || name.endsWith("_events"))).toEqual([
      "list_events", "add_event", "update_event", "delete_event",
    ]);
  });
});
