import { BRAND } from "@/lib/brand";
import { addDays } from "@/lib/calendar";
import type { CalendarFeedEvent } from "@/lib/family-calendar/feed-repository";
import { utcToZoned } from "@/lib/time-zone";

/**
 * The calendar feed as iCalendar text (RFC 5545), pure: one plain `VEVENT` per row, with UTC times
 * (or a `VALUE=DATE` pair for all-day events), and none of the parts the app doesn't need — no
 * `RRULE` (a repeat is one row per occurrence), no `VTIMEZONE`, no `VALARM` (the app's own
 * notifications already cover it, and alarms from the feed would notify twice).
 */

const CRLF = "\r\n";
/** RFC 5545 §3.1: a line is at most 75 octets, not counting its line break. */
const MAX_LINE_OCTETS = 75;
/** How often calendar apps are asked to refetch, in the two properties they honour. */
const REFRESH = "PT15M";
const PRODID = `-//${BRAND.name}//Family Calendar//EN`;
/** The suffix of every event's `UID`, so it stays the same if the app is renamed. */
const UID_DOMAIN = "simple-ledger";

/** `text` as an iCalendar TEXT value: `\`, `;`, `,` and line breaks escaped; other control characters dropped. */
export function escapeIcsText(text: string) {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    // Control characters (the tab stays) can't appear in an iCalendar line.
    .replaceAll(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function utf8Length(codePoint: number) {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds one content line at 75 octets: each following line starts with one space (which counts
 * toward its 75) and carries on. A character is never split, so a line may be a little shorter
 * than the limit when the next one is two to four octets wide. Returns the lines CRLF-joined.
 */
export function foldIcsLine(line: string) {
  const lines: string[] = [];
  let current = "";
  let octets = 0;
  for (const character of line) {
    const width = utf8Length(character.codePointAt(0)!);
    if (octets + width > MAX_LINE_OCTETS) {
      lines.push(current);
      current = " ";
      octets = 1;
    }
    current += character;
    octets += width;
  }
  lines.push(current);
  return lines.join(CRLF);
}

/** `20261103T070000Z` for an ISO instant. */
function utcStamp(instant: string) {
  return new Date(instant).toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** `20261103` for a `YYYY-MM-DD` date. */
const dateValue = (date: string) => date.replaceAll("-", "");

function eventLines(event: CalendarFeedEvent, now: Date) {
  const updated = Number.isNaN(Date.parse(event.updatedAt)) ? now.toISOString() : event.updatedAt;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.id}@${UID_DOMAIN}`,
    `DTSTAMP:${utcStamp(updated)}`,
    `LAST-MODIFIED:${utcStamp(updated)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.allDay) {
    // Stored as local midnight of the first day and of the day after the last, in the event's own
    // zone: read the dates there, not in UTC, which can be the evening before.
    const start = utcToZoned(new Date(event.startsAt), event.timezone).date;
    const end = utcToZoned(new Date(event.endsAt), event.timezone).date;
    lines.push(`DTSTART;VALUE=DATE:${dateValue(start)}`, `DTEND;VALUE=DATE:${dateValue(end > start ? end : addDays(start, 1))}`);
  } else {
    lines.push(`DTSTART:${utcStamp(event.startsAt)}`, `DTEND:${utcStamp(event.endsAt)}`);
  }
  if (event.notes) lines.push(`DESCRIPTION:${escapeIcsText(event.notes)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  lines.push("END:VEVENT");
  return lines;
}

/**
 * The feed's iCalendar text: CRLF line endings, lines folded at 75 octets, a final line break.
 * `familyName` (null once the owner has left their family) names the calendar; `now` stands in for
 * the stamp of an event whose `updatedAt` can't be read.
 */
export function toICalendar({
  familyName,
  events,
  now,
}: {
  familyName: string | null;
  events: readonly CalendarFeedEvent[];
  now: Date;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeIcsText(familyName?.trim() || BRAND.name)}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    ...events.flatMap((event) => eventLines(event, now)),
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
