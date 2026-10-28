import { describe, expect, it } from "vitest";

import { calendarEventsApiKey } from "@/lib/api/keys";
import {
  attendeesForNewEvent,
  eventsAttendedBy,
  isFilterOn,
  memberFilterHref,
  memberIdFor,
  memberOfKey,
  parseMemberFilter,
} from "@/lib/family-calendar/filters";
import { ANA, calendarEvent, DAN, LUCA } from "@/test/calendar-events";

const params = (query: string) => new URLSearchParams(query);
const MEMBERS = ["m-ana", "m-dan", "m-luca"];

describe("parseMemberFilter", () => {
  it("is Everyone without a ?member= or with an empty or 'all' one", () => {
    expect(parseMemberFilter(params(""))).toBe("all");
    expect(parseMemberFilter(params("member="))).toBe("all");
    expect(parseMemberFilter(params("member=all"))).toBe("all");
  });

  it("reads Me and a member id", () => {
    expect(parseMemberFilter(params("member=me"))).toBe("me");
    expect(parseMemberFilter(params("member=m-ana"))).toBe("m-ana");
  });

  it("falls back to Everyone for someone who isn't in the family, once the family is known", () => {
    expect(parseMemberFilter(params("member=m-gone"), MEMBERS)).toBe("all");
    expect(parseMemberFilter(params("member=m-gone"))).toBe("m-gone");
    expect(parseMemberFilter(params("member=me"), MEMBERS)).toBe("me");
  });

  it("gives back the family's own spelling of an id", () => {
    expect(parseMemberFilter(params("member=M-ANA"), MEMBERS)).toBe("m-ana");
  });
});

describe("memberIdFor", () => {
  it("asks for no member under Everyone", () => {
    expect(memberIdFor("all", "m-dan")).toBeNull();
  });

  it("asks for the caller's own member id under Me", () => {
    expect(memberIdFor("me", "m-dan")).toBe("m-dan");
    expect(memberIdFor("me", null)).toBeNull();
  });

  it("asks for the chosen member's id", () => {
    expect(memberIdFor("m-ana", "m-dan")).toBe("m-ana");
  });
});

describe("isFilterOn", () => {
  it("presses Me for Me or for the caller's own id, and a member's chip for their id", () => {
    expect(isFilterOn("me", "m-dan", "m-dan")).toBe(true);
    expect(isFilterOn("m-dan", "m-dan", "m-dan")).toBe(true);
    expect(isFilterOn("m-ana", "m-ana", "m-dan")).toBe(true);
    expect(isFilterOn("m-ana", "m-luca", "m-dan")).toBe(false);
    expect(isFilterOn("all", "m-dan", "m-dan")).toBe(false);
    expect(isFilterOn("me", "m-ana", "m-dan")).toBe(false);
  });
});

describe("memberFilterHref", () => {
  it("writes ?member= for a filter and leaves the URL clean for Everyone", () => {
    expect(memberFilterHref("/calendar", "", "me")).toBe("/calendar?member=me");
    expect(memberFilterHref("/calendar", "", "m-ana")).toBe("/calendar?member=m-ana");
    expect(memberFilterHref("/calendar", "member=me", "all")).toBe("/calendar");
  });

  it("keeps the view and date", () => {
    expect(memberFilterHref("/calendar", "view=week&date=2026-11-04", "m-ana")).toBe("/calendar?view=week&date=2026-11-04&member=m-ana");
    expect(memberFilterHref("/calendar", "view=week&member=me", "m-luca")).toBe("/calendar?view=week&member=m-luca");
  });
});

describe("eventsAttendedBy", () => {
  const swim = calendarEvent({ id: "swim", start: "2026-10-28 18:00", attendees: [ANA] });
  const dinner = calendarEvent({ id: "dinner", start: "2026-10-28 19:00", attendees: [ANA, DAN] });
  const football = calendarEvent({ id: "football", start: "2026-10-28 17:00", attendees: [LUCA] });

  it("keeps the events the member is one of the attendees of", () => {
    expect(eventsAttendedBy([swim, dinner, football], "m-dan").map((event) => event.id)).toEqual(["dinner"]);
    expect(eventsAttendedBy([swim, dinner, football], "m-ana").map((event) => event.id)).toEqual(["swim", "dinner"]);
  });

  it("keeps every event without a member", () => {
    expect(eventsAttendedBy([swim, football], null)).toEqual([swim, football]);
    expect(eventsAttendedBy([swim, football], undefined)).toEqual([swim, football]);
  });
});

describe("memberOfKey", () => {
  it("reads the member a cached range was fetched for", () => {
    expect(memberOfKey(calendarEventsApiKey("2026-10-26T00:00:00Z", "2026-11-02T00:00:00Z", "m-ana"))).toBe("m-ana");
  });

  it("is null for an unfiltered range and for other keys", () => {
    expect(memberOfKey(calendarEventsApiKey("2026-10-26T00:00:00Z", "2026-11-02T00:00:00Z"))).toBeNull();
    expect(memberOfKey("/api/todos?member=m-ana")).toBeNull();
  });
});

describe("attendeesForNewEvent", () => {
  it("starts an event with the member whose chip is pressed, and leaves Everyone to the form's default", () => {
    expect(attendeesForNewEvent("m-ana", "m-dan")).toEqual(["m-ana"]);
    expect(attendeesForNewEvent("me", "m-dan")).toEqual(["m-dan"]);
    expect(attendeesForNewEvent("all", "m-dan")).toBeUndefined();
  });
});
