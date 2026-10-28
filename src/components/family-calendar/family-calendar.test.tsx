import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { eventAppearance, eventLabel, attendeeNames } from "@/components/family-calendar/event-appearance";
import { goingSummary, repeatEndsOn } from "@/components/family-calendar/event-dialog";
import { EventRow, seriesLabel } from "@/components/family-calendar/event-row";
import { NoFamilyCalendar } from "@/components/family-calendar/calendar-screen";
import { MemberChips } from "@/components/family-calendar/member-chips";
import { dayDots, MonthDots, SelectedDay } from "@/components/family-calendar/month-dots";
import { MonthView } from "@/components/family-calendar/month-view";
import { scopeChoices } from "@/components/family-calendar/scope-dialog";
import { WeekView } from "@/components/family-calendar/week-view";
import { weekViewDays } from "@/lib/family-calendar/view";
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
});

describe("WeekView", () => {
  const WEEK = weekViewDays("2026-10-28");
  const view = (events: ReturnType<typeof calendarEvents>, days: readonly string[] = WEEK, today = "2026-10-28") => render(
    <WeekView days={days} today={today} events={events} colorOf={colorOf} onOpenEvent={noop} onAddAt={noop} onOpenDay={noop} />,
  );

  it("shows the seven days from Monday, today marked, with a column to click on each", () => {
    const html = view([]);
    expect(html.indexOf("Mon")).toBeLessThan(html.indexOf("Sun"));
    expect(html).toContain("Show Wednesday 28 October 2026 (today)");
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Add an event on /g)).toHaveLength(7);
    expect(html.match(/aria-label="Add an all-day event on /g)).toHaveLength(7);
    expect(html).toContain("All day");
  });

  it("labels the hours of the whole day, so the grid can scroll to 00:00 and 23:00", () => {
    const html = view([]);
    for (const hour of ["01:00", "07:00", "12:00", "22:00", "23:00"]) expect(html).toContain(`>${hour}<`);
  });

  it("places a timed event by its time: 09:30 to 11:00 sits 9.5 hours down and 1.5 hours tall", () => {
    const html = view(calendarEvents({ title: "Dentist", start: "2026-10-28 09:30", end: "2026-10-28 11:00" }));
    expect(html).toContain('aria-label="Dentist, 09:30 – 11:00, Ana"');
    // 48 px an hour, plus the 1 px inset; two pixels shorter than 1.5 hours so neighbours show a gap.
    expect(html).toContain("top:457px");
    expect(html).toContain("height:70px");
  });

  it("draws overlapping events side by side, each half the width", () => {
    const html = view([
      ...calendarEvents({ id: "a", title: "Concert", start: "2026-10-28 09:00", end: "2026-10-28 11:00" }),
      ...calendarEvents({ id: "b", title: "Plumber", start: "2026-10-28 10:00", end: "2026-10-28 12:00", attendees: [DAN] }),
    ]);
    expect(html).toContain("left:calc(0% + 1px);width:calc(50% - 2px)");
    expect(html).toContain("left:calc(50% + 1px);width:calc(50% - 2px)");
  });

  it("colours a block like the month does: the member's colour for one attendee, neutral for several", () => {
    /** The CSS rule of the block's own class. */
    const blockCss = (html: string) => {
      const className = html.match(/aria-label="Swimming[^"]*" class="(css-\w+)"/)?.[1];
      return html.match(new RegExp(`\\.${className}\\{[^}]*\\}`))?.[0] ?? "";
    };
    const one = blockCss(view(calendarEvents({ start: "2026-10-28 09:00", attendees: [ANA] })));
    expect(one).toContain("var(--chakra-colors-member-2)");
    const several = blockCss(view(calendarEvents({ start: "2026-10-28 09:00", attendees: [ANA, DAN] })));
    expect(several).not.toContain("member-2");
    expect(several).toContain("var(--chakra-colors-bg-emphasized)");
  });

  it("puts all-day and multi-day events in the all-day row, not on the grid", () => {
    const html = view([
      ...calendarEvents({ id: "bd", title: "Birthday", start: "2026-10-29" }),
      ...calendarEvents({ id: "trip", title: "Trip", start: "2026-10-30", end: "2026-11-01" }),
      ...calendarEvents({ id: "sl", title: "Sleepover", start: "2026-10-30 20:00", end: "2026-10-31 10:00" }),
    ]);
    expect(html).toContain('aria-label="Birthday, All day, Ana"');
    expect(html).toContain('aria-label="Trip, All day, Ana"');
    expect(html).toContain("Sleepover");
    // Each is one chip in the row; none is a positioned block (those carry a pixel `top`).
    expect(html).not.toMatch(/aria-label="(Birthday|Trip|Sleepover)[^"]*"[^>]*style="top:/);
    expect(html.match(/aria-label="Trip, /g)).toHaveLength(1);
  });

  it("says how many events don't fit in the all-day row", () => {
    const many = ["a", "b", "c", "d", "e"].flatMap((id) => calendarEvents({ id, title: `Day ${id}`, start: "2026-10-29" }));
    const html = view(many);
    expect(html).toContain("+2 more");
    expect(html).toContain("Show 2 more events on Thursday 29 October 2026");
  });

  it("shows only three days on a phone", () => {
    const html = view([], weekViewDays("2026-10-28", 3));
    expect(html.match(/aria-label="Add an event on /g)).toHaveLength(3);
    expect(html).toContain("Add an event on Wednesday 28 October 2026");
    expect(html).toContain("Add an event on Friday 30 October 2026");
    expect(html).not.toContain("Add an event on Saturday 31 October 2026");
  });

  it("draws no 'now' line on the server: it appears once the browser knows the time", () => {
    expect(view([])).not.toContain("now-line");
  });

  it("marks an unconfirmed event so it can be told from a saved one", () => {
    const [pending] = calendarEvents({ id: "pending-1", start: "2026-10-28 09:00" });
    expect(view([pending])).toContain("opacity:0.6");
  });
});

describe("MonthDots", () => {
  const view = (events: ReturnType<typeof calendarEvents>, selected = "2026-10-28") => render(
    <MonthDots selected={selected} today="2026-10-28" events={events} colorOf={colorOf} onSelectDay={noop} />,
  );

  it("shows a button per day of the six-week grid, with today and the chosen day marked", () => {
    const html = view([], "2026-10-30");
    expect(html.match(/aria-pressed=/g)).toHaveLength(42);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Friday 30 October 2026, no events"');
    expect(html).toContain("Wednesday 28 October 2026 (today), no events");
  });

  it("counts a day's events in its label, and draws dots rather than chips", () => {
    const html = view(calendarEvents({ id: "a", title: "Swimming", start: "2026-10-29 18:00" }));
    expect(html).toContain("Thursday 29 October 2026, 1 event");
    expect(html).not.toContain("Swimming");
  });

  it("draws one dot per event in the member's colour, grey for several people, at most three", () => {
    const events = [
      ...calendarEvents({ id: "a", start: "2026-10-29 08:00", attendees: [ANA] }),
      ...calendarEvents({ id: "b", start: "2026-10-29 09:00", attendees: [ANA, DAN] }),
      ...calendarEvents({ id: "c", start: "2026-10-29 10:00", attendees: [DAN] }),
      ...calendarEvents({ id: "d", start: "2026-10-29 11:00", attendees: [DAN] }),
    ];
    expect(dayDots(events.slice(0, 3), colorOf)).toEqual({ colors: ["member.2", "fg.subtle", "member.1"], more: 0 });
    expect(dayDots(events, colorOf)).toEqual({ colors: ["member.2", "fg.subtle", "member.1"], more: 1 });
    expect(dayDots([], colorOf)).toEqual({ colors: [], more: 0 });
  });

  it("dots a multi-day event on every day it covers", () => {
    const html = view(calendarEvents({ id: "trip", title: "Trip", start: "2026-10-29", end: "2026-10-31" }));
    for (const day of ["Thursday 29 October", "Friday 30 October", "Saturday 31 October"]) expect(html).toContain(`${day} 2026, 1 event`);
  });
});

describe("SelectedDay", () => {
  it("lists the chosen day's events under the grid, with a way to add one", () => {
    const events = calendarEvents({ id: "sw", title: "Swimming", start: "2026-10-29 18:00", end: "2026-10-29 19:00" });
    const html = render(<SelectedDay date="2026-10-29" events={events} colorOf={colorOf} onOpenEvent={noop} onAdd={noop} />);
    expect(html).toContain("Thursday 29 October 2026");
    expect(html).toContain("1 event");
    expect(html).toContain("Swimming");
    expect(html).toContain("18:00 – 19:00");
    expect(html).toContain("Add");
  });

  it("says when nothing is planned", () => {
    const html = render(<SelectedDay date="2026-10-29" events={[]} colorOf={colorOf} onOpenEvent={noop} onAdd={noop} />);
    expect(html).toContain("Nothing planned.");
  });
});

describe("MemberChips", () => {
  const members = [
    { memberId: "m-dan", displayName: "Dan", username: "dan", avatarUrl: null, color: null },
    { memberId: "m-ana", displayName: "Ana", username: "ana", avatarUrl: null, color: null },
  ] as unknown as Parameters<typeof MemberChips>[0]["members"];
  const chips = (filter: Parameters<typeof MemberChips>[0]["filter"]) => render(
    <MemberChips filter={filter} members={members} myMemberId="m-dan" colorOf={colorOf} onChange={noop} />,
  );
  /** The text of each pressed chip. */
  const pressed = (html: string) => html.split("<button").filter((chip) => chip.includes('aria-pressed="true"'))
    .map((chip) => chip.slice(chip.indexOf(">") + 1).split("</button>")[0].replace(/<[^>]*>/g, ""));

  it("offers Everyone, Me and each other member, leaving the caller out of the member chips", () => {
    const html = chips("all");
    expect(html.indexOf("Everyone")).toBeLessThan(html.indexOf("Me<"));
    expect(html.indexOf("Me<")).toBeLessThan(html.indexOf("Ana"));
    expect(html.match(/aria-pressed=/g)).toHaveLength(3);
    expect(html).not.toContain("Dan");
  });

  it("presses the chip of the filter", () => {
    expect(chips("all").match(/aria-pressed="true"/g)).toHaveLength(1);
    for (const [filter, label] of [["all", /Everyone$/], ["me", /Me$/], ["m-dan", /Me$/], ["m-ana", /Ana$/]] as const) {
      const on = pressed(chips(filter));
      expect(on).toHaveLength(1);
      expect(on[0]).toMatch(label);
    }
  });
});
