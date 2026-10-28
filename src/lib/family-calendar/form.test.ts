import { describe, expect, it } from "vitest";

import {
  clampRepeatCount,
  draftFromEvent,
  newDraft,
  parseEdit,
  parseNewEvent,
  toCreatePayload,
  toEditPayload,
  toggleAttendee,
  withAllDay,
  withStart,
  type EventDraft,
} from "@/lib/family-calendar/form";
import { ANA, calendarEvent, DAN } from "@/test/calendar-events";

// Wednesday 28 October 2026, 14:20 in Bucharest (UTC+2 after the clock change on the 25th).
const NOW = new Date("2026-10-28T12:20:00Z");

const draft = (overrides: Partial<EventDraft> = {}): EventDraft => ({
  ...newDraft({ date: "2026-11-04", attendeeMemberIds: ["m-ana"], now: NOW }),
  title: "Swimming",
  ...overrides,
});

describe("newDraft", () => {
  it("starts at 09:00 on another day, for an hour, for just the caller", () => {
    expect(newDraft({ date: "2026-11-04", attendeeMemberIds: ["m-ana"], now: NOW })).toMatchObject({
      title: "", allDay: false, startDate: "2026-11-04", startTime: "09:00", endDate: "2026-11-04", endTime: "10:00",
      attendeeMemberIds: ["m-ana"], repeatKind: "none",
    });
  });

  it("starts at the next full hour today", () => {
    expect(newDraft({ date: "2026-10-28", attendeeMemberIds: [], now: NOW })).toMatchObject({ startTime: "15:00", endTime: "16:00" });
  });

  it("starts at 22:00 at the latest, so the event ends the same day", () => {
    const late = new Date("2026-10-28T20:40:00Z"); // 22:40 local
    expect(newDraft({ date: "2026-10-28", attendeeMemberIds: [], now: late })).toMatchObject({ startTime: "22:00", endTime: "23:00" });
  });

  it("takes the start time of a clicked slot", () => {
    expect(newDraft({ date: "2026-11-04", startTime: "13:30", attendeeMemberIds: [], now: NOW })).toMatchObject({ startTime: "13:30", endTime: "14:30" });
  });
});

describe("draftFromEvent", () => {
  it("reads a timed event on its own wall clock", () => {
    const event = calendarEvent({ start: "2026-11-03 18:00", end: "2026-11-03 19:30", attendees: [ANA, DAN] });
    expect(draftFromEvent(event)).toMatchObject({
      allDay: false, startDate: "2026-11-03", startTime: "18:00", endDate: "2026-11-03", endTime: "19:30",
      attendeeMemberIds: ["m-ana", "m-dan"],
    });
  });

  it("gives an all-day event its last day as the end date", () => {
    const trip = calendarEvent({ start: "2026-11-07", end: "2026-11-10" });
    expect(draftFromEvent(trip)).toMatchObject({ allDay: true, startDate: "2026-11-07", endDate: "2026-11-10" });
  });
});

describe("withStart", () => {
  it("moves the end with the start, keeping the length", () => {
    const moved = withStart(draft(), { startTime: "11:00" });
    expect(moved).toMatchObject({ startTime: "11:00", endDate: "2026-11-04", endTime: "12:00" });
  });

  it("carries the end over midnight", () => {
    const moved = withStart(draft({ startTime: "22:00", endTime: "23:00" }), { startTime: "23:30" });
    expect(moved).toMatchObject({ startDate: "2026-11-04", endDate: "2026-11-05", endTime: "00:30" });
  });

  it("moves the end by the same days for a new start date", () => {
    expect(withStart(draft(), { startDate: "2026-11-09" })).toMatchObject({ startDate: "2026-11-09", endDate: "2026-11-09", endTime: "10:00" });
    const trip = draft({ allDay: true, startDate: "2026-11-07", endDate: "2026-11-10" });
    expect(withStart(trip, { startDate: "2026-11-14" })).toMatchObject({ startDate: "2026-11-14", endDate: "2026-11-17" });
  });

  it("leaves the end alone when it wasn't after the start, or a field is empty", () => {
    expect(withStart(draft({ endTime: "08:00" }), { startTime: "11:00" }).endTime).toBe("08:00");
    expect(withStart(draft(), { startTime: "" }).endTime).toBe("10:00");
  });
});

describe("withAllDay and toggleAttendee", () => {
  it("keeps the times so switching back restores them", () => {
    const allDay = withAllDay(draft(), true);
    expect(allDay.allDay).toBe(true);
    expect(withAllDay(allDay, false)).toMatchObject({ allDay: false, startTime: "09:00", endTime: "10:00" });
  });

  it("adds and removes people going", () => {
    expect(toggleAttendee(draft(), "m-dan").attendeeMemberIds).toEqual(["m-ana", "m-dan"]);
    expect(toggleAttendee(draft({ attendeeMemberIds: ["m-ana", "m-dan"] }), "m-ana").attendeeMemberIds).toEqual(["m-dan"]);
  });

  it("clamps a repeat count to 2 to 10", () => {
    expect([0, 1, 2, 6.4, 10, 11, 40, NaN].map(clampRepeatCount)).toEqual([2, 2, 2, 6, 10, 10, 10, 4]);
  });
});

describe("toCreatePayload", () => {
  it("sends a timed one-off with its times and no repeat count", () => {
    expect(toCreatePayload(draft({ notes: "Bring a towel", location: "Olympic pool" }))).toEqual({
      title: "Swimming", notes: "Bring a towel", location: "Olympic pool", allDay: false,
      startDate: "2026-11-04", startTime: "09:00", endDate: "2026-11-04", endTime: "10:00",
      attendeeMemberIds: ["m-ana"], repeat: { kind: "none" },
    });
  });

  it("drops the times of an all-day event", () => {
    expect(toCreatePayload(draft({ allDay: true, endDate: "2026-11-06" }))).toMatchObject({
      allDay: true, startTime: null, endTime: null, startDate: "2026-11-04", endDate: "2026-11-06",
    });
  });

  it("sends a weekly repeat with its count, within the limits", () => {
    expect(toCreatePayload(draft({ repeatKind: "weekly", repeatCount: 6 })).repeat).toEqual({ kind: "weekly", count: 6 });
    expect(toCreatePayload(draft({ repeatKind: "daily", repeatCount: 99 })).repeat).toEqual({ kind: "daily", count: 10 });
  });
});

describe("parseNewEvent", () => {
  it("accepts a good draft and keeps the ids of the people going", () => {
    const parsed = parseNewEvent(draft({ attendeeMemberIds: ["m-ana", "m-dan", "m-ana"], repeatKind: "weekly", repeatCount: 6 }));
    expect(parsed.ok && parsed.value).toMatchObject({
      title: "Swimming", attendeeMemberIds: ["m-ana", "m-dan"], repeat: { kind: "weekly", count: 6 }, endDate: "2026-11-04",
    });
  });

  it("names the field that is wrong", () => {
    const empty = parseNewEvent(draft({ title: "  " }));
    expect(!empty.ok && empty.fieldErrors.title).toEqual(["Enter a title."]);
    const backwards = parseNewEvent(draft({ endTime: "08:00" }));
    expect(!backwards.ok && backwards.fieldErrors.endTime).toEqual(["The event must end after it starts."]);
    const nobody = parseNewEvent(draft({ attendeeMemberIds: [] }));
    expect(!nobody.ok && nobody.fieldErrors.attendeeMemberIds).toEqual(["Choose at least one attendee."]);
  });

  it("refuses an event over 30 days", () => {
    const long = parseNewEvent(draft({ allDay: true, endDate: "2026-12-31" }));
    expect(!long.ok && long.fieldErrors.endDate).toEqual(["An event can last at most 30 days."]);
  });
});

describe("toEditPayload", () => {
  const event = calendarEvent({ start: "2026-11-03 18:00", end: "2026-11-03 19:00", attendees: [ANA] });
  const same = draftFromEvent(event);

  it("is null when nothing changed, trimming first", () => {
    expect(toEditPayload(event, same, "this")).toBeNull();
    expect(toEditPayload(event, { ...same, title: "  Swimming " }, "all")).toBeNull();
  });

  it("sends only the changed text fields, with the scope", () => {
    expect(toEditPayload(event, { ...same, title: "Diving", location: "Pool" }, "following")).toEqual({ title: "Diving", location: "Pool", scope: "following" });
  });

  it("sends only the times when only the times changed", () => {
    expect(toEditPayload(event, { ...same, startTime: "19:00", endTime: "20:00" }, "following")).toEqual({
      startTime: "19:00", endTime: "20:00", scope: "following",
    });
  });

  it("sends both dates when the start date moved, so the end moves with it", () => {
    expect(toEditPayload(event, { ...same, startDate: "2026-11-05", endDate: "2026-11-05" }, "this")).toEqual({
      startDate: "2026-11-05", endDate: "2026-11-05", scope: "this",
    });
    expect(toEditPayload(event, { ...same, endDate: "2026-11-04" }, "this")).toMatchObject({ startDate: "2026-11-03", endDate: "2026-11-04" });
  });

  it("sends the people going only when the set changed, in any order", () => {
    const two = calendarEvent({ start: "2026-11-03 18:00", attendees: [ANA, DAN] });
    expect(toEditPayload(two, { ...draftFromEvent(two), attendeeMemberIds: ["m-dan", "m-ana"] }, "this")).toBeNull();
    expect(toEditPayload(two, { ...draftFromEvent(two), attendeeMemberIds: ["m-dan"] }, "all")).toEqual({ attendeeMemberIds: ["m-dan"], scope: "all" });
  });

  it("sends allDay, and both times when switching to a timed event", () => {
    expect(toEditPayload(event, { ...same, allDay: true }, "this")).toEqual({ allDay: true, scope: "this" });
    const trip = calendarEvent({ start: "2026-11-07", end: "2026-11-08" });
    expect(toEditPayload(trip, { ...draftFromEvent(trip), allDay: false, startTime: "10:00", endTime: "12:00" }, "this")).toEqual({
      allDay: false, startTime: "10:00", endTime: "12:00", scope: "this",
    });
  });
});

describe("parseEdit", () => {
  const event = calendarEvent({ start: "2026-11-03 18:00", end: "2026-11-03 19:00", attendees: [ANA] });
  const same = draftFromEvent(event);

  it("is null when nothing changed", () => {
    expect(parseEdit(event, same, "this")).toBeNull();
  });

  it("parses the changes with the scope, keeping the people going", () => {
    const parsed = parseEdit(event, { ...same, title: "Diving", attendeeMemberIds: ["m-dan", "m-ana"] }, "following");
    expect(parsed && parsed.ok && parsed.value).toEqual({ title: "Diving", attendeeMemberIds: ["m-dan", "m-ana"], scope: "following" });
  });

  it("checks the whole event, so a time that ends before it starts is caught on its field", () => {
    const parsed = parseEdit(event, { ...same, endTime: "17:00" }, "this");
    expect(parsed && !parsed.ok && parsed.fieldErrors.endTime).toEqual(["The event must end after it starts."]);
  });

  it("refuses an empty title and nobody going", () => {
    const untitled = parseEdit(event, { ...same, title: "" }, "this");
    expect(untitled && !untitled.ok && untitled.fieldErrors.title).toBeDefined();
    const nobody = parseEdit(event, { ...same, attendeeMemberIds: [] }, "this");
    expect(nobody && !nobody.ok && nobody.fieldErrors.attendeeMemberIds).toBeDefined();
  });
});
