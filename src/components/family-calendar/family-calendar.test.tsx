import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { eventAppearance, eventLabel, attendeeNames } from "@/components/family-calendar/event-appearance";
import { goingSummary, repeatEndsOn } from "@/components/family-calendar/event-dialog";
import { EventRow, seriesLabel } from "@/components/family-calendar/event-row";
import { NoFamilyCalendar, WeekPlaceholder } from "@/components/family-calendar/calendar-screen";
import { MonthView } from "@/components/family-calendar/month-view";
import { scopeChoices } from "@/components/family-calendar/scope-dialog";
import { ledgerSystem } from "@/components/ui/theme";
import { ANA, calendarEvent, calendarEvents, colorOf, DAN, LUCA } from "@/test/calendar-events";

const render = (node: React.ReactNode) => renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
const noop = () => {};

describe("eventAppearance", () => {
  it("takes the member's colour for an event with one attendee", () => {
    expect(eventAppearance(calendarEvent({ start: "2026-11-03 18:00", attendees: [ANA] }), colorOf)).toEqual({
      bg: "member.2", color: "member.2.fg", neutral: false,
    });
  });

  it("uses the neutral family colour for several attendees", () => {
    expect(eventAppearance(calendarEvent({ start: "2026-11-03 18:00", attendees: [ANA, DAN] }), colorOf)).toMatchObject({ bg: "bg.emphasized", neutral: true });
  });

  it("uses the neutral colour for one attendee without a palette colour of their own", () => {
    const beyond = (memberId: string | null | undefined) => (memberId ? "fg.subtle" : undefined);
    expect(eventAppearance(calendarEvent({ start: "2026-11-03 18:00", attendees: [LUCA] }), beyond).neutral).toBe(true);
    expect(eventAppearance(calendarEvent({ start: "2026-11-03 18:00", attendees: [LUCA] }), () => undefined).neutral).toBe(true);
  });
});

describe("labels", () => {
  it("names the attendees in a sentence", () => {
    expect(attendeeNames([ANA])).toBe("Ana");
    expect(attendeeNames([ANA, DAN])).toBe("Ana and Dan");
    expect(attendeeNames([ANA, DAN, LUCA])).toBe("Ana, Dan and Luca");
    expect(attendeeNames([{ ...ANA, name: null }])).toBe("A family member");
  });

  it("describes an event for a screen reader: what, when, which of a series, who", () => {
    const [first, second] = calendarEvents({ id: "sw", start: "2026-11-03 18:00", end: "2026-11-03 19:00", repeat: { kind: "weekly", count: 6 } });
    expect(eventLabel(first)).toBe("Swimming, 18:00 – 19:00, 1 of 6, Ana");
    expect(seriesLabel(second)).toBe("2 of 6");
    expect(seriesLabel(calendarEvent({ start: "2026-11-03 18:00" }))).toBeNull();
  });
});

describe("scopeChoices", () => {
  it("says how many events each answer reaches", () => {
    const [, , third] = calendarEvents({ id: "sw", start: "2026-11-03 18:00", repeat: { kind: "weekly", count: 6 } });
    expect(scopeChoices(third)).toEqual([
      { scope: "this", label: "This event", description: "Only event 3 of 6." },
      { scope: "following", label: "This and following events", description: "Events 3 to 6: 4 events." },
      { scope: "all", label: "All events", description: "All 6 events in the series." },
    ]);
  });

  it("calls the last occurrence's following events just that one", () => {
    const last = calendarEvents({ id: "sw", start: "2026-11-03 18:00", repeat: { kind: "weekly", count: 6 } })[5];
    expect(scopeChoices(last)[1].description).toBe("Event 6, the last of 6.");
  });
});

describe("the form's summaries", () => {
  const people = [
    { memberId: "m-ana", name: "Ana", avatarUrl: null },
    { memberId: "m-dan", name: "Dan", avatarUrl: null },
    { memberId: "m-luca", name: "Luca", avatarUrl: null },
  ];

  it("says Just me, Everyone, names, or asks for someone", () => {
    expect(goingSummary(people, ["m-ana"], "m-ana")).toBe("Just me");
    expect(goingSummary(people, ["m-ana", "m-dan", "m-luca"], "m-ana")).toBe("Everyone");
    expect(goingSummary(people, ["m-dan", "m-luca"], "m-ana")).toBe("Dan, Luca");
    expect(goingSummary(people, ["m-dan"], "m-ana")).toBe("Dan");
    expect(goingSummary(people, [], "m-ana")).toBe("Choose at least one person.");
  });

  it("works out where a repeat ends", () => {
    expect(repeatEndsOn("2026-11-04", "weekly", 6)).toBe("2026-12-09");
    expect(repeatEndsOn("2026-11-04", "daily", 10)).toBe("2026-11-13");
  });
});

describe("MonthView", () => {
  const view = (events: ReturnType<typeof calendarEvents>, date = "2026-10-28", today = "2026-10-28") => render(
    <MonthView date={date} today={today} events={events} colorOf={colorOf} onOpenEvent={noop} onAddOnDay={noop} onOpenDay={noop} />,
  );

  it("shows the weekdays from Monday and every day of a six-week grid", () => {
    const html = view([]);
    expect(html.indexOf("Mon")).toBeLessThan(html.indexOf("Tue"));
    expect(html.indexOf("Sat")).toBeLessThan(html.indexOf("Sun"));
    // 42 day cells to add on, and the grid reaches into September and November.
    expect(html.match(/aria-label="Add an event on /g)).toHaveLength(42);
    expect(html).toContain("Add an event on Monday 28 September 2026");
    expect(html).toContain("Add an event on Sunday 8 November 2026");
  });

  it("marks today", () => {
    const html = view([]);
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
    expect(html).toContain("Show Wednesday 28 October 2026 (today)");
  });

  it("draws an event as a chip with its time and title, in the member's colour", () => {
    const html = view(calendarEvents({ start: "2026-10-29 18:00", end: "2026-10-29 19:00", title: "Swimming" }));
    expect(html).toContain('aria-label="Swimming, 18:00 – 19:00, Ana"');
    expect(html).toContain("18:00");
  });

  it("shows three chips a day and '+2 more' for the rest", () => {
    const events = [1, 2, 3, 4, 5].flatMap((hour) => calendarEvents({ id: `e${hour}`, title: `Event ${hour}`, start: `2026-10-29 0${hour}:00` }));
    const html = view(events);
    expect(html).toContain("Event 3");
    expect(html).not.toContain("Event 4");
    expect(html).toContain("+2 more");
    expect(html).toContain("Show 2 more events on Thursday 29 October 2026");
  });

  it("draws a multi-day event once per week row it crosses", () => {
    // Saturday 7 to Tuesday 10 November: the last row of this grid, then beyond it.
    const trip = calendarEvents({ id: "trip", title: "Trip", start: "2026-11-07", end: "2026-11-10" });
    expect(view(trip).match(/aria-label="Trip, All day/g)).toHaveLength(1);
    // November's grid has the trip's two rows.
    expect(view(trip, "2026-11-15", "2026-11-15").match(/aria-label="Trip, All day/g)).toHaveLength(2);
  });

  it("leaves out events from outside the grid", () => {
    expect(view(calendarEvents({ title: "Faraway", start: "2027-03-01 09:00" }))).not.toContain("Faraway");
  });

  it("marks an unconfirmed event so it can be told from a saved one", () => {
    const [pending] = calendarEvents({ id: "pending-1", start: "2026-10-29 18:00" });
    expect(view([pending])).toContain("opacity:0.6");
  });
});

describe("EventRow", () => {
  it("shows the time, title, place, series and who's going", () => {
    const [event] = calendarEvents({ id: "sw", start: "2026-11-03 18:00", end: "2026-11-03 19:00", location: "Olympic pool", repeat: { kind: "weekly", count: 6 }, attendees: [ANA, DAN] });
    const html = render(<EventRow event={event} date="2026-11-03" colorOf={colorOf} onOpen={noop} />);
    expect(html).toContain("18:00 – 19:00");
    expect(html).toContain("Swimming");
    expect(html).toContain("Olympic pool");
    expect(html).toContain("1 of 6");
    expect(html).toContain("Going: Ana and Dan");
  });
});

describe("the empty states", () => {
  it("sends a user without a family to Settings → Family", () => {
    const html = render(<NoFamilyCalendar />);
    expect(html).toContain("The calendar belongs to a family");
    expect(html).toContain('href="/settings/family"');
  });

  it("holds the Week view's place", () => {
    const html = render(<WeekPlaceholder onShow={noop} />);
    expect(html).toContain("The week view is coming soon");
    expect(html).toContain("Show the month");
    expect(html).toContain("Show the agenda");
  });
});
