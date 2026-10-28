import { describe, expect, it } from "vitest";

import {
  calendarEventEditSchema,
  calendarEventSchema,
  calendarRangeQuerySchema,
  calendarScopeQuerySchema,
} from "@/lib/validation/calendar-event";

const MEMBER = "6f1c3a52-9c1e-4a52-8a53-3d3f5b9e3a01";
const OTHER = "0b9d7a34-6c4a-4f43-a1d4-52f0a7d5c102";

const timed = {
  title: "Swimming",
  startDate: "2026-11-03",
  startTime: "18:00",
  endTime: "19:00",
  attendeeMemberIds: [MEMBER],
};

describe("calendarEventSchema", () => {
  it("trims text and fills defaults", () => {
    expect(calendarEventSchema.parse({ ...timed, title: "  Swimming ", notes: " bring towels \n", location: " Pool " })).toEqual({
      title: "Swimming",
      notes: "bring towels",
      location: "Pool",
      allDay: false,
      startDate: "2026-11-03",
      startTime: "18:00",
      endDate: "2026-11-03",
      endTime: "19:00",
      attendeeMemberIds: [MEMBER],
      repeat: { kind: "none", count: 1 },
    });
  });

  it("accepts a repeat of 2 to 10 and sets a one-off's count to 1", () => {
    expect(calendarEventSchema.parse({ ...timed, repeat: { kind: "weekly", count: 10 } }).repeat).toEqual({ kind: "weekly", count: 10 });
    expect(calendarEventSchema.parse({ ...timed, repeat: { kind: "daily", count: 2 } }).repeat).toEqual({ kind: "daily", count: 2 });
    expect(calendarEventSchema.parse({ ...timed, repeat: { kind: "none", count: 7 } }).repeat).toEqual({ kind: "none", count: 1 });
    expect(calendarEventSchema.parse({ ...timed, repeat: { kind: "none" } }).repeat).toEqual({ kind: "none", count: 1 });
  });

  it("keeps an all-day event's dates and drops its times", () => {
    expect(calendarEventSchema.parse({
      ...timed, allDay: true, endDate: "2026-11-05", startTime: "18:00", endTime: null,
    })).toMatchObject({ allDay: true, startDate: "2026-11-03", endDate: "2026-11-05", startTime: null, endTime: null });
    expect(calendarEventSchema.parse({ title: "Holiday", allDay: true, startDate: "2026-11-03", attendeeMemberIds: [MEMBER] }))
      .toMatchObject({ endDate: "2026-11-03", startTime: null, endTime: null });
  });

  it("accepts an event across midnight and each attendee once", () => {
    expect(calendarEventSchema.parse({
      ...timed, startTime: "22:00", endDate: "2026-11-04", endTime: "01:00", attendeeMemberIds: [MEMBER, OTHER, MEMBER],
    })).toMatchObject({ endDate: "2026-11-04", attendeeMemberIds: [MEMBER, OTHER] });
  });

  it("accepts the limits", () => {
    expect(calendarEventSchema.safeParse({
      ...timed, title: "x".repeat(200), notes: "y".repeat(2000), location: "z".repeat(200), startTime: "00:00", endDate: "2026-12-03", endTime: "00:00",
    }).success).toBe(true);
    expect(calendarEventSchema.safeParse({ title: "Trip", allDay: true, startDate: "2026-11-01", endDate: "2026-11-30", attendeeMemberIds: [MEMBER] }).success).toBe(true);
  });

  it.each([
    ["no title", { ...timed, title: "   " }],
    ["a long title", { ...timed, title: "x".repeat(201) }],
    ["long notes", { ...timed, notes: "y".repeat(2001) }],
    ["a long location", { ...timed, location: "z".repeat(201) }],
    ["no start date", { ...timed, startDate: undefined }],
    ["an impossible date", { ...timed, startDate: "2026-02-30" }],
    ["an impossible end date", { ...timed, endDate: "2026-13-01" }],
    ["a malformed date", { ...timed, startDate: "03/11/2026" }],
    ["no start time", { ...timed, startTime: null }],
    ["no end time", { ...timed, endTime: undefined }],
    ["a malformed time", { ...timed, startTime: "6pm" }],
    ["an out-of-range time", { ...timed, endTime: "24:00" }],
    ["no attendees", { ...timed, attendeeMemberIds: [] }],
    ["attendees missing", { ...timed, attendeeMemberIds: undefined }],
    ["an attendee that isn't an id", { ...timed, attendeeMemberIds: ["ana"] }],
    ["an end before the start", { ...timed, endTime: "17:00" }],
    ["an end equal to the start", { ...timed, endTime: "18:00" }],
    ["an end date before the start date", { ...timed, endDate: "2026-11-02" }],
    ["an all-day end before its start", { ...timed, allDay: true, endDate: "2026-11-02" }],
    ["an event over 30 days", { ...timed, endDate: "2026-12-04", endTime: "19:00" }],
    ["an all-day event over 30 days", { title: "Trip", allDay: true, startDate: "2026-11-01", endDate: "2026-12-01", attendeeMemberIds: [MEMBER] }],
    ["a repeat of 11", { ...timed, repeat: { kind: "weekly", count: 11 } }],
    ["a repeat of 1", { ...timed, repeat: { kind: "daily", count: 1 } }],
    ["a repeat without a count", { ...timed, repeat: { kind: "daily" } }],
    ["a fractional count", { ...timed, repeat: { kind: "daily", count: 2.5 } }],
    ["an unknown repeat", { ...timed, repeat: { kind: "monthly", count: 3 } }],
  ])("rejects %s", (_name, input) => {
    expect(calendarEventSchema.safeParse(input).success).toBe(false);
  });

  it("names the field of each problem", () => {
    const paths = (input: unknown) => (calendarEventSchema.safeParse(input).error?.issues ?? []).map((issue) => issue.path.join("."));
    expect(paths({ ...timed, endTime: "17:00" })).toEqual(["endTime"]);
    expect(paths({ ...timed, attendeeMemberIds: [] })).toEqual(["attendeeMemberIds"]);
    expect(paths({ ...timed, repeat: { kind: "weekly", count: 11 } })).toEqual(["repeat.count"]);
    expect(paths({ ...timed, startTime: null })).toEqual(["startTime"]);
  });
});

describe("calendarEventEditSchema", () => {
  it("defaults the scope to this event", () => {
    expect(calendarEventEditSchema.parse({ title: " Swim " })).toEqual({ title: "Swim", scope: "this" });
  });

  it("accepts any subset of the fields with each scope", () => {
    expect(calendarEventEditSchema.parse({
      scope: "following", startDate: "2026-11-04", startTime: "17:00", endTime: "18:00", attendeeMemberIds: [OTHER, OTHER],
    })).toEqual({ scope: "following", startDate: "2026-11-04", startTime: "17:00", endTime: "18:00", attendeeMemberIds: [OTHER] });
    expect(calendarEventEditSchema.parse({ scope: "all", allDay: true, startTime: null, notes: "", location: " " }))
      .toEqual({ scope: "all", allDay: true, startTime: null, notes: "", location: "" });
  });

  it.each([
    ["nothing", {}],
    ["only a scope", { scope: "all" }],
    ["an empty title", { title: "  " }],
    ["no attendees", { attendeeMemberIds: [] }],
    ["a bad date", { startDate: "2026-02-30" }],
    ["a bad time", { startTime: "25:00" }],
    ["an end date before the start date", { startDate: "2026-11-05", endDate: "2026-11-04" }],
    ["an unknown scope", { title: "Swim", scope: "future" }],
    ["a repeat", { title: "Swim", repeat: { kind: "daily", count: 3 } }],
  ])("rejects %s", (_name, input) => {
    expect(calendarEventEditSchema.safeParse(input).success).toBe(false);
  });
});

describe("calendarRangeQuerySchema", () => {
  it("reads the range as instants, normalising offsets, with an optional member", () => {
    const parsed = calendarRangeQuerySchema.parse({ from: "2026-11-01T02:00:00+02:00", to: "2026-12-01T00:00:00Z", member: MEMBER });

    expect(parsed.from.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(parsed.to.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(parsed.member).toBe(MEMBER);
    expect(calendarRangeQuerySchema.parse({ from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" }).member).toBeUndefined();
  });

  it.each([
    ["no range", {}],
    ["no end", { from: "2026-11-01T00:00:00Z" }],
    ["dates without times", { from: "2026-11-01", to: "2026-12-01" }],
    ["a member that isn't a UUID", { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z", member: "all" }],
  ])("rejects %s", (_name, input) => {
    expect(calendarRangeQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe("calendarScopeQuerySchema", () => {
  it("defaults to this event and accepts each scope", () => {
    expect(calendarScopeQuerySchema.parse({})).toEqual({ scope: "this" });
    expect(calendarScopeQuerySchema.parse({ scope: "following" })).toEqual({ scope: "following" });
    expect(calendarScopeQuerySchema.parse({ scope: "all" })).toEqual({ scope: "all" });
  });

  it("rejects any other scope", () => {
    expect(calendarScopeQuerySchema.safeParse({ scope: "future" }).success).toBe(false);
    expect(calendarScopeQuerySchema.safeParse({ scope: "" }).success).toBe(false);
  });
});
