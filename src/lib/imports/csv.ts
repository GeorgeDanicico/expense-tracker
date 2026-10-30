import { ImportError } from "@/lib/imports/types";

/**
 * A small RFC 4180 reader for statement exports: quoted fields, doubled quotes, delimiters and
 * line breaks inside quotes, and CRLF, LF or CR line ends, with the delimiter detected among comma,
 * semicolon and tab. Written in-house because it is short and a dependency isn't worth it. Pure:
 * it never reads or logs anything, and its errors never contain text from the file.
 */

export const CSV_DELIMITERS = [",", ";", "\t"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** How many records the delimiter detection looks at. */
const DETECTION_RECORDS = 50;
const BOM = "﻿";

/**
 * Splits `text` into records of fields. A quote opens a quoted field only at the start of a field;
 * anywhere else it is an ordinary character. Empty lines are dropped (an empty quoted field is
 * kept), and a final line break doesn't make an extra record. Throws an `unreadable_statement`
 * `ImportError` when a quote is never closed, rather than swallowing the rest of the file into one
 * field. `maxRecords` stops reading early (for looking at the header only).
 */
export function parseCsv(
  text: string,
  delimiter: CsvDelimiter,
  options: { maxRecords?: number } = {},
): string[][] {
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;
  let sawQuotes = false;

  const endField = () => {
    record.push(field);
    field = "";
    atFieldStart = true;
  };
  const endRecord = () => {
    endField();
    const blankLine = record.length === 1 && record[0] === "" && !sawQuotes;
    if (!blankLine) records.push(record);
    record = [];
    sawQuotes = false;
  };

  const length = text.length;
  for (let i = 0; i < length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else inQuotes = false;
      continue;
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true;
      sawQuotes = true;
      atFieldStart = false;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      if (records.length >= maxRecords) return records;
    } else {
      field += char;
      atFieldStart = false;
    }
  }

  if (inQuotes) throw new ImportError("unreadable_statement");
  if (field !== "" || record.length > 0 || sawQuotes) endRecord();
  return records;
}

/**
 * Splits the physical lines of a CSV into fields the way `parseCsv` does (a quote opens a quoted
 * field only at the start of a field, `""` is a quote inside one, the delimiter is not special
 * inside quotes), but one line at a time and without ever throwing, so a statement already cut
 * into numbered lines can be looked at field by field. The quoting state carries over from one line
 * to the next, so a quoted field that runs over several lines is not split at its line breaks; the
 * pieces of such a field are returned as separate fields of the lines they are on. A quote that is
 * never closed just stays open to the end.
 */
export function splitCsvLines(lines: readonly string[], delimiter: CsvDelimiter): string[][] {
  let inQuotes = false;
  let atFieldStart = true;

  return lines.map((line) => {
    const fields: string[] = [];
    let field = "";
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (inQuotes) {
        if (char !== '"') field += char;
        else if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else if (char === '"' && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
      } else if (char === delimiter) {
        fields.push(field);
        field = "";
        atFieldStart = true;
      } else {
        field += char;
        atFieldStart = false;
      }
    }
    fields.push(field);
    if (!inQuotes) atFieldStart = true;
    return fields;
  });
}

/**
 * The delimiter that splits the first records most consistently: the one under which the most
 * records have the same number of fields (more than one), then the one with more fields, then the
 * earlier of comma, semicolon and tab. A file with no delimiter at all gets a comma.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  let best: CsvDelimiter = ",";
  let bestConsistent = 0;
  let bestFields = 0;

  for (const delimiter of CSV_DELIMITERS) {
    let records: string[][];
    try {
      records = parseCsv(text, delimiter, { maxRecords: DETECTION_RECORDS });
    } catch {
      continue;
    }

    const perLength = new Map<number, number>();
    for (const record of records) {
      if (record.length > 1) perLength.set(record.length, (perLength.get(record.length) ?? 0) + 1);
    }
    let consistent = 0;
    let fields = 0;
    for (const [recordFields, count] of perLength) {
      if (count > consistent || (count === consistent && recordFields > fields)) {
        consistent = count;
        fields = recordFields;
      }
    }

    if (consistent > bestConsistent || (consistent === bestConsistent && fields > bestFields)) {
      best = delimiter;
      bestConsistent = consistent;
      bestFields = fields;
    }
  }
  return best;
}

/** Reads CSV text with its delimiter detected; a leading byte order mark is ignored. */
export function readCsv(
  text: string,
  options: { maxRecords?: number } = {},
): { delimiter: CsvDelimiter; records: string[][] } {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  const delimiter = detectDelimiter(body);
  return { delimiter, records: parseCsv(body, delimiter, options) };
}
