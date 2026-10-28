// A small iCalendar reader for the feed's tests: it undoes the folding and the escaping, so a test can
// say what a calendar app would read. It only knows what the feed writes: one VCALENDAR with plain
// VEVENTs, and no nested components.

export type IcsProperty = { name: string; params: Record<string, string>; value: string };
export type IcsEvent = Record<string, IcsProperty>;
export type IcsCalendar = { properties: Record<string, IcsProperty>; events: IcsEvent[] };

/** Joins the folded lines (a CRLF followed by a space or tab) back together. */
export function unfoldIcs(text: string) {
  return text.replaceAll(/\r\n[ \t]/g, "");
}

/** The inverse of the feed's text escaping: `\n` is a line break; `\\`, `\;` and `\,` are themselves. */
export function unescapeIcsText(value: string) {
  return value.replaceAll(/\\([nN\\;,])/g, (_match, character: string) => (character === "n" || character === "N" ? "\n" : character));
}

function parseLine(line: string): IcsProperty {
  const colon = line.indexOf(":");
  if (colon < 0) throw new Error(`Not a content line: ${JSON.stringify(line)}`);
  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params = Object.fromEntries(rawParams.map((param) => param.split("=") as [string, string]));
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Parses the feed's text; throws when it isn't well-formed (wrong line endings, unbalanced BEGIN and END). */
export function parseICalendar(text: string): IcsCalendar {
  if (!text.endsWith("\r\n")) throw new Error("A calendar ends with CRLF.");
  if (/(^|[^\r])\n/.test(text)) throw new Error("A bare LF line ending.");
  const lines = unfoldIcs(text).split("\r\n").slice(0, -1);
  if (lines[0] !== "BEGIN:VCALENDAR" || lines.at(-1) !== "END:VCALENDAR") throw new Error("Not a VCALENDAR.");

  const calendar: IcsCalendar = { properties: {}, events: [] };
  let event: IcsEvent | null = null;
  for (const line of lines.slice(1, -1)) {
    if (line === "BEGIN:VEVENT") {
      if (event) throw new Error("Nested VEVENT.");
      event = {};
    } else if (line === "END:VEVENT") {
      if (!event) throw new Error("END:VEVENT without BEGIN.");
      calendar.events.push(event);
      event = null;
    } else {
      const property = parseLine(line);
      (event ?? calendar.properties)[property.name] = property;
    }
  }
  if (event) throw new Error("Unclosed VEVENT.");
  return calendar;
}

/** The physical lines of the text, as a calendar app receives them (line breaks excluded). */
export function physicalLines(text: string) {
  return text.split("\r\n").slice(0, -1);
}
