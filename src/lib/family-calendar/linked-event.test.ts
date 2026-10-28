import { describe, expect, it, vi } from "vitest";

import {
  CALENDAR_EVENT_PARAM,
  LINKED_EVENT_MISSING_MESSAGE,
  linkedEventHref,
  loadLinkedEvent,
  withoutEventHref,
} from "@/lib/family-calendar/linked-event";
import { ApiError } from "@/lib/api/client";
import { calendarEvents } from "@/test/calendar-events";

// `/calendar?event=<id>`: what the page does with it. The effect that runs these in the page is
// not exercised here (the component tests render static markup, with no DOM); the pieces it
// calls are.

const [swimming] = calendarEvents({ id: "e1", start: "2026-11-03 18:00" });
const TODAY = "2026-10-28";

describe("withoutEventHref", () => {
  it("drops only ?event=, keeping the view, date, member filter and anything else", () => {
    expect(withoutEventHref("/calendar", "?event=e1")).toBe("/calendar");
    expect(withoutEventHref("/calendar", "?view=week&event=e1&date=2026-11-03&member=me")).toBe("/calendar?view=week&date=2026-11-03&member=me");
    expect(withoutEventHref("/calendar", "")).toBe("/calendar");
    expect(CALENDAR_EVENT_PARAM).toBe("event");
  });
});

describe("linkedEventHref", () => {
  it("moves the date to the event's day and drops ?event=", () => {
    expect(linkedEventHref("/calendar", "?event=e1", swimming, TODAY)).toBe("/calendar?date=2026-11-03");
  });

  it("keeps the view and the member filter", () => {
    expect(linkedEventHref("/calendar", "?event=e1&view=week&member=me", swimming, TODAY))
      .toBe("/calendar?view=week&member=me&date=2026-11-03");
  });

  it("leaves the date out when the event is today", () => {
    expect(linkedEventHref("/calendar", "?event=e1&date=2026-11-20", swimming, "2026-11-03")).toBe("/calendar");
  });

  it("reads the day on the event's own wall clock", () => {
    // 00:30 local on 4 November is still 3 November in UTC.
    const [late] = calendarEvents({ id: "e2", start: "2026-11-04 00:30" });
    expect(late.startsAt).toBe("2026-11-03T22:30:00.000Z");
    expect(linkedEventHref("/calendar", "?event=e2", late, TODAY)).toBe("/calendar?date=2026-11-04");
  });

  it("opens an agenda-by-default phone on the event's day without adding ?view=", () => {
    expect(linkedEventHref("/calendar", "?event=e1", swimming, TODAY, "agenda")).toBe("/calendar?date=2026-11-03");
  });
});

describe("loadLinkedEvent", () => {
  it("answers the event the fetch gives", async () => {
    const fetchEvent = vi.fn().mockResolvedValue(swimming);
    expect(await loadLinkedEvent("e1", fetchEvent)).toBe(swimming);
    expect(fetchEvent).toHaveBeenCalledWith("e1");
  });

  it.each([
    ["a missing event", new ApiError("Event not found.", 404)],
    ["an id that isn't one", new ApiError("Invalid event identifier.", 400)],
    ["a failed request", new Error("Failed to fetch")],
  ])("answers null for %s, so the page says it's gone", async (_label, error) => {
    expect(await loadLinkedEvent("e1", () => Promise.reject(error))).toBeNull();
    expect(LINKED_EVENT_MISSING_MESSAGE).toContain("no longer exists");
  });
});
