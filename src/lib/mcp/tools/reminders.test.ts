import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { createMcpServer } from "@/lib/mcp/server";
import { aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

// The session user; the fake reminder repository acts as them, as RLS does.
const OWNER = "owner";
const OTHER_USER = "10000000-0000-4000-8000-000000000009";
const KID_USER = "10000000-0000-4000-8000-000000000002";
const MISSING = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";

async function call(name: string, args: Record<string, unknown> = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ userId: OWNER, email: "owner@example.com" });
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError, text, body: text.startsWith("{") ? JSON.parse(text) : {} };
}

describe("MCP reminder tools", () => {
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    // 12:00 in Bucharest on Sunday 25 October 2026.
    vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
    repositories = resetFakeRepositories();
    repositories.reminders.callerId = OWNER;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const reminders = () => repositories.reminders;
  const titles = (body: { reminders: { title: string }[] }) => body.reminders.map((reminder) => reminder.title);

  describe("list_reminders", () => {
    it("lists the caller's reminders with their state and next due date and time", async () => {
      reminders().seed({
        title: "Pay rent", notes: "Transfer", startsOn: "2026-10-01", nextDueOn: "2026-11-01",
        nextDueAt: "2026-11-01T07:00:00.000Z", repeatUnit: "month", leadMinutes: [0, 1440],
      });

      const { body, isError } = await call("list_reminders");

      expect(isError).toBeFalsy();
      expect(body.reminders).toEqual([{
        id: expect.any(String),
        title: "Pay rent",
        notes: "Transfer",
        state: "upcoming",
        nextDueOn: "2026-11-01",
        timeOfDay: "09:00",
        startsOn: "2026-10-01",
        repeatUnit: "month",
        repeatInterval: 1,
        leadTimes: ["at_time", "1_day"],
        notificationsMuted: false,
        snoozedUntil: null,
      }]);
    });

    it("filters by state", async () => {
      reminders().seed({ title: "Later", nextDueOn: "2026-11-01", nextDueAt: "2026-11-01T07:00:00.000Z" });
      reminders().seed({ title: "Tonight", nextDueOn: "2026-10-25", nextDueAt: "2026-10-25T18:00:00.000Z", timeOfDay: "20:00" });
      reminders().seed({ title: "Late", nextDueOn: "2026-10-20", nextDueAt: "2026-10-20T06:00:00.000Z" });
      reminders().seed({
        title: "Snoozed", nextDueOn: "2026-10-20", nextDueAt: "2026-10-20T06:00:00.000Z", snoozedUntil: "2026-10-25T11:00:00.000Z",
      });
      reminders().seed({ title: "Finished", nextDueOn: null, nextDueAt: null });

      const listed = async (state: string) => titles((await call("list_reminders", { state })).body);

      expect(await listed("upcoming")).toEqual(["Later"]);
      expect(await listed("due")).toEqual(["Tonight"]);
      expect(await listed("overdue")).toEqual(["Late"]);
      expect(await listed("snoozed")).toEqual(["Snoozed"]);
      expect(await listed("done")).toEqual(["Finished"]);
    });

    it("never shows another user's reminders, a kid's included", async () => {
      reminders().seed({ title: "Mine" });
      reminders().seed({ title: "Theirs", userId: OTHER_USER });
      reminders().seed({ title: "Kid's", userId: KID_USER });
      repositories.family.membership = aParent();

      expect(titles((await call("list_reminders")).body)).toEqual(["Mine"]);
    });

    it("rejects an unknown state", async () => {
      const { text, isError } = await call("list_reminders", { state: "later" });

      expect(isError).toBe(true);
      expect(text).toContain("Input validation error");
    });
  });

  describe("add_reminder", () => {
    it("adds a one-off at 09:00 notifying at the time by default, for the caller", async () => {
      const { body, isError } = await call("add_reminder", { title: "Renew passport", startsOn: "2026-11-10" });

      expect(isError).toBeFalsy();
      expect(body.reminder).toMatchObject({
        title: "Renew passport", notes: "", state: "upcoming", nextDueOn: "2026-11-10", timeOfDay: "09:00",
        repeatUnit: "none", repeatInterval: 1, leadTimes: ["at_time"], notificationsMuted: false,
      });
      expect(reminders().rows).toEqual([expect.objectContaining({
        userId: OWNER, nextDueAt: "2026-11-10T07:00:00.000Z", timezone: "Europe/Bucharest",
      })]);
    });

    it.each([
      ["week", 2],
      ["month", 1],
      ["year", 1],
    ])("adds a reminder repeating every %s", async (repeatUnit, repeatInterval) => {
      const { body, isError } = await call("add_reminder", {
        title: "Repeat", startsOn: "2026-10-31", timeOfDay: "18:30", repeatUnit, repeatInterval,
      });

      expect(isError).toBeFalsy();
      expect(body.reminder).toMatchObject({ repeatUnit, repeatInterval, nextDueOn: "2026-10-31", timeOfDay: "18:30" });
    });

    it("keeps a one-off's interval at 1", async () => {
      const { body } = await call("add_reminder", { title: "Once", startsOn: "2026-11-01", repeatInterval: 5 });

      expect(body.reminder).toMatchObject({ repeatUnit: "none", repeatInterval: 1 });
    });

    it("takes lead times by name, notes and mute", async () => {
      const { body, isError } = await call("add_reminder", {
        title: "Car insurance", startsOn: "2026-12-01", repeatUnit: "year",
        leadTimes: ["1_week", "at_time", "3_days"], notes: "Call the broker", notificationsMuted: true,
      });

      expect(isError).toBeFalsy();
      expect(body.reminder).toMatchObject({
        leadTimes: ["at_time", "3_days", "1_week"], notes: "Call the broker", notificationsMuted: true,
      });
      expect(reminders().rows[0]).toMatchObject({ leadMinutes: [0, 4320, 10080], nextNotifyAt: null });
    });

    it("reports invalid fields as field errors without adding anything", async () => {
      const { body, isError } = await call("add_reminder", {
        title: " ", startsOn: "2026-02-30", timeOfDay: "25:00", repeatUnit: "month", repeatInterval: 13,
        leadTimes: ["at_time", "at_time"],
      });

      expect(isError).toBe(true);
      expect(Object.keys(body.fieldErrors).sort()).toEqual(["leadTimes", "repeatInterval", "startsOn", "timeOfDay", "title"]);
      expect(body.fieldErrors.leadTimes).toEqual(["Choose each lead time once."]);
      expect(reminders().rows).toEqual([]);
    });

    it("refuses more than three lead times", async () => {
      const { body, isError } = await call("add_reminder", {
        title: "Too many", startsOn: "2026-11-01", leadTimes: ["at_time", "1_hour", "1_day", "1_week"],
      });

      expect(isError).toBe(true);
      expect(body.fieldErrors.leadTimes).toEqual(["Choose at most 3 lead times."]);
    });

    it("rejects an unknown lead time name as an error, not a crash", async () => {
      const { text, isError } = await call("add_reminder", { title: "Odd", startsOn: "2026-11-01", leadTimes: ["2_hours"] });

      expect(isError).toBe(true);
      expect(text).toContain("Input validation error");
      expect(reminders().rows).toEqual([]);
    });
  });

  describe("complete_reminder", () => {
    it("moves a monthly reminder to the next month", async () => {
      const rent = reminders().seed({
        title: "Pay rent", startsOn: "2026-10-01", repeatUnit: "month",
        nextDueOn: "2026-10-01", nextDueAt: "2026-10-01T06:00:00.000Z",
      });

      const { body, isError } = await call("complete_reminder", { id: rent.id });

      expect(isError).toBeFalsy();
      expect(body.reminder).toMatchObject({ id: rent.id, nextDueOn: "2026-11-01", state: "upcoming" });
      expect(reminders().completions).toEqual([expect.objectContaining({ reminderId: rent.id, occurrenceOn: "2026-10-01" })]);
      expect(reminders().rows[0].nextDueAt).toBe("2026-11-01T07:00:00.000Z");
    });

    it("marks a one-off done, then refuses to complete it again", async () => {
      const once = reminders().seed({ startsOn: "2026-10-20", nextDueOn: "2026-10-20", nextDueAt: "2026-10-20T06:00:00.000Z" });

      const first = await call("complete_reminder", { id: once.id });
      const second = await call("complete_reminder", { id: once.id });

      expect(first.body.reminder).toMatchObject({ state: "done", nextDueOn: null });
      expect(second.isError).toBe(true);
      expect(second.body.error).toBe("This reminder is already done.");
      expect(reminders().completions).toHaveLength(1);
    });

    it("reports a missing reminder", async () => {
      const { body, isError } = await call("complete_reminder", { id: MISSING });

      expect(isError).toBe(true);
      expect(body.error).toBe("Reminder not found.");
    });

    it("rejects an id that isn't a UUID", async () => {
      const { text, isError } = await call("complete_reminder", { id: "rent" });

      expect(isError).toBe(true);
      expect(text).toContain("Input validation error");
    });
  });

  it.each([
    ["another user's", OTHER_USER, aParent],
    ["a kid's, for a parent,", KID_USER, aParent],
    ["a parent's, for a kid,", OTHER_USER, aKid],
  ])("treats %s reminder as not found, leaving it alone", async (_label, owner, membership) => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = membership();
    const theirs = reminders().seed({ title: "Theirs", userId: owner, repeatUnit: "month" });
    const before = { ...theirs };

    const { body, isError } = await call("complete_reminder", { id: theirs.id });

    expect(isError).toBe(true);
    expect(body.error).toBe("Reminder not found.");
    expect(reminders().rows).toEqual([before]);
    expect(reminders().completions).toEqual([]);
  });
});
