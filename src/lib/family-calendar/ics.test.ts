import { describe, expect, it } from "vitest";

import type { CalendarFeedEvent } from "@/lib/family-calendar/feed-repository";
import { escapeIcsText, foldIcsLine, toICalendar } from "@/lib/family-calendar/ics";
import { seriesRows } from "@/lib/family-calendar/series";
import { parseICalendar, physicalLines, unescapeIcsText } from "@/test/ics";

const NOW = new Date("2026-10-29T08:00:00Z");
const UPDATED = "2026-10-28T09:30:15.123Z";
const octets = (line: string) => new TextEncoder().encode(line).length;

function feedEvent(fields: Partial<CalendarFeedEvent> = {}): CalendarFeedEvent {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    title: "Swimming",
    notes: "",
    location: "",
    allDay: false,
    startsAt: "2026-11-03T07:00:00.000Z",
    endsAt: "2026-11-03T08:00:00.000Z",
    timezone: "Europe/Bucharest",
    updatedAt: UPDATED,
    ...fields,
  };
}

function render(events: CalendarFeedEvent[], familyName: string | null = "The Danicicos") {
  return toICalendar({ familyName, events, now: NOW });
}

/** The feed rows of a series, as `calendar_feed()` returns them. */
function seriesEvents(count: number): CalendarFeedEvent[] {
  return seriesRows(
    { allDay: false, startDate: "2026-11-03", startTime: "09:00", endDate: "2026-11-03", endTime: "10:00", repeat: { kind: "weekly", count } },
    "Europe/Bucharest",
  ).map((row) => feedEvent({
    id: `40000000-0000-4000-8000-00000000010${row.seriesIndex}`,
    title: "Swimming",
    location: "Olympic pool",
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  }));
}

describe("toICalendar snapshots", () => {
  it("a timed event", async () => {
    await expect(render([feedEvent({ notes: "Bring a towel", location: "Olympic pool" })])).toMatchFileSnapshot("./__snapshots__/feed-timed-event.ics");
  });

  it("an all-day event, on the local dates, with the end exclusive", async () => {
    // Local midnight in Bucharest (UTC+2 in November) is 22:00 UTC the evening before.
    const event = feedEvent({
      id: "40000000-0000-4000-8000-000000000002",
      title: "Ana's birthday",
      allDay: true,
      startsAt: "2026-11-09T22:00:00.000Z",
      endsAt: "2026-11-10T22:00:00.000Z",
    });
    await expect(render([event])).toMatchFileSnapshot("./__snapshots__/feed-all-day-event.ics");
  });

  it("a 3-week series, one event per occurrence", async () => {
    await expect(render(seriesEvents(3))).toMatchFileSnapshot("./__snapshots__/feed-series-3-weeks.ics");
  });

  it("a calendar with no events", async () => {
    await expect(render([], null)).toMatchFileSnapshot("./__snapshots__/feed-empty.ics");
  });
});

describe("toICalendar read back", () => {
  it("reads back as the events it was given", () => {
    const calendar = parseICalendar(render(seriesEvents(3)));

    expect(calendar.properties.VERSION.value).toBe("2.0");
    expect(calendar.properties["X-WR-CALNAME"].value).toBe("The Danicicos");
    expect(calendar.properties["REFRESH-INTERVAL"]).toMatchObject({ params: { VALUE: "DURATION" }, value: "PT15M" });
    expect(calendar.properties["X-PUBLISHED-TTL"].value).toBe("PT15M");
    expect(calendar.events.map((event) => event.DTSTART.value)).toEqual(["20261103T070000Z", "20261110T070000Z", "20261117T070000Z"]);
    expect(calendar.events.map((event) => event.DTEND.value)).toEqual(["20261103T080000Z", "20261110T080000Z", "20261117T080000Z"]);
    expect(new Set(calendar.events.map((event) => event.UID.value)).size).toBe(3);
    expect(calendar.events[0].UID.value).toBe("40000000-0000-4000-8000-000000000101@simple-ledger");
  });

  it("stamps each event from its updatedAt, to the second, in UTC", () => {
    const [event] = parseICalendar(render([feedEvent()])).events;

    expect(event.DTSTAMP.value).toBe("20261028T093015Z");
    expect(event["LAST-MODIFIED"].value).toBe("20261028T093015Z");
  });

  it("falls back to now for an updatedAt it can't read", () => {
    expect(parseICalendar(render([feedEvent({ updatedAt: "yesterday" })])).events[0].DTSTAMP.value).toBe("20261029T080000Z");
  });

  it("uses the local dates of an all-day event, not its UTC dates, across the clock change", () => {
    // Sunday 25 October 2026 is the autumn change in Romania: midnight is 21:00 UTC the day before
    // until then (UTC+3), and 22:00 UTC after (UTC+2). A 3-day event, the 25th to the 27th, spans it;
    // the end date is the day after the last one.
    const event = feedEvent({ allDay: true, startsAt: "2026-10-24T21:00:00.000Z", endsAt: "2026-10-27T22:00:00.000Z" });
    const [read] = parseICalendar(render([event])).events;

    expect(read.DTSTART).toMatchObject({ params: { VALUE: "DATE" }, value: "20261025" });
    expect(read.DTEND).toMatchObject({ params: { VALUE: "DATE" }, value: "20261028" });
  });

  it("reads an all-day event's dates in its own time zone", () => {
    // 22:00 UTC is already the next morning in Auckland, and still the same day's evening in Lisbon.
    const auckland = feedEvent({ allDay: true, timezone: "Pacific/Auckland", startsAt: "2026-11-08T11:00:00.000Z", endsAt: "2026-11-09T11:00:00.000Z" });
    const [read] = parseICalendar(render([auckland])).events;

    expect(read.DTSTART.value).toBe("20261109");
    expect(read.DTEND.value).toBe("20261110");
  });

  it("gives an all-day event at least one day when its end isn't after its start", () => {
    const [read] = parseICalendar(render([feedEvent({ allDay: true, startsAt: "2026-11-09T22:00:00.000Z", endsAt: "2026-11-09T22:00:00.000Z" })])).events;

    expect(read.DTEND.value).toBe("20261111");
  });

  it("leaves out an empty description and location, and keeps a present one", () => {
    const [bare, full] = parseICalendar(render([feedEvent(), feedEvent({ notes: "Bring a towel", location: "Pool" })])).events;

    expect(bare).not.toHaveProperty("DESCRIPTION");
    expect(bare).not.toHaveProperty("LOCATION");
    expect(full.DESCRIPTION.value).toBe("Bring a towel");
    expect(full.LOCATION.value).toBe("Pool");
  });

  it("names the calendar after the family, or the app when there is none", () => {
    expect(parseICalendar(render([], "Smith, Jones & co; \\ family")).properties["X-WR-CALNAME"].value)
      .toBe("Smith\\, Jones & co\\; \\\\ family");
    expect(parseICalendar(render([], null)).properties["X-WR-CALNAME"].value).toBe("iFam");
    expect(parseICalendar(render([], "  ")).properties["X-WR-CALNAME"].value).toBe("iFam");
  });

  it("holds none of the parts the app doesn't use", () => {
    const text = render(seriesEvents(3));

    for (const part of ["VALARM", "RRULE", "EXDATE", "RECURRENCE-ID", "VTIMEZONE", "TZID", "ATTENDEE", "ORGANIZER"]) {
      expect(text).not.toContain(part);
    }
  });
});

describe("escaping", () => {
  it("escapes backslashes, semicolons, commas and line breaks", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
  });

  it("drops control characters but keeps tabs", () => {
    expect(escapeIcsText("a\u0000b\u0007c\u001fd\u007fe\tf")).toBe("abcde\tf");
  });

  it("round-trips through the feed, in the title, notes and location", () => {
    const nasty = "Dentist; 10:00, Dr. Ionescu\\Popa\nBring: card, X-ray;\r\nsecond line";
    const [event] = parseICalendar(render([feedEvent({ title: nasty, notes: nasty, location: nasty })])).events;

    for (const name of ["SUMMARY", "DESCRIPTION", "LOCATION"]) {
      expect(unescapeIcsText(event[name].value)).toBe(nasty.replaceAll("\r\n", "\n"));
    }
  });

  it("can't inject a property through a line break in the text", () => {
    const [event] = parseICalendar(render([feedEvent({ title: "Hi\r\nATTENDEE:mailto:x@example.test\nEND:VEVENT" })])).events;

    expect(event).not.toHaveProperty("ATTENDEE");
    expect(event.SUMMARY.value).toBe("Hi\\nATTENDEE:mailto:x@example.test\\nEND:VEVENT");
  });
});

describe("folding", () => {
  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:Swimming")).toBe("SUMMARY:Swimming");
  });

  it("folds at 75 octets, each continuation starting with a space", () => {
    const folded = foldIcsLine(`SUMMARY:${"a".repeat(200)}`);
    const lines = folded.split("\r\n");

    expect(lines.map(octets)).toEqual([75, 75, 60]);
    expect(lines.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(folded.replaceAll("\r\n ", "")).toBe(`SUMMARY:${"a".repeat(200)}`);
  });

  it("never splits a multibyte character, and keeps every physical line within 75 octets", () => {
    // 2-, 3- and 4-octet characters (é, €, 🏊) in a long title, at every offset the fold can land on.
    for (let pad = 0; pad < 8; pad++) {
      const title = `${"x".repeat(pad)}${"Înot în Ștefănești € 🏊 ".repeat(12)}`;
      const text = render([feedEvent({ title, notes: title, location: title })]);
      const lines = physicalLines(text);

      expect(lines.every((line) => octets(line) <= 75)).toBe(true);
      // Every line is valid UTF-8 on its own: re-encoding what a strict decoder reads changes nothing.
      const decoder = new TextDecoder("utf-8", { fatal: true });
      for (const line of lines) expect(() => decoder.decode(new TextEncoder().encode(line))).not.toThrow();
      expect(lines.some((line) => line.includes("�"))).toBe(false);

      const [event] = parseICalendar(text).events;
      expect(unescapeIcsText(event.SUMMARY.value)).toBe(title);
      expect(unescapeIcsText(event.DESCRIPTION.value)).toBe(title);
    }
  });

  it("really folds a long UTF-8 title across several lines", () => {
    const title = "Ștefan și Ioana la înot ".repeat(10).trim();
    const lines = physicalLines(render([feedEvent({ title })]));
    const start = lines.findIndex((line) => line.startsWith("SUMMARY:"));

    expect(lines[start + 1].startsWith(" ")).toBe(true);
    expect(lines.filter((line) => octets(line) > 75)).toEqual([]);
  });

  it("uses CRLF line endings and ends with one", () => {
    const text = render([feedEvent({ title: "x".repeat(300) })]);

    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });
});
