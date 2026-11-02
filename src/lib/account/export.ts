import "server-only";

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

import { EXPORT_SECTIONS, type ExportRow, type ExportSection } from "@/lib/account/data-repository";
import { BRAND } from "@/lib/brand";

/**
 * "Download my data" (security plan S13): a ZIP with a README, and each part of the user's data as
 * `<section>.json` (exactly what the database returned) and `<section>.csv` (the same rows as a
 * spreadsheet), plus their profile picture when they have one. Streamed: each section is read,
 * compressed and sent before the next one is read.
 */

const README = `${BRAND.name}: your data

This archive holds everything ${BRAND.name} keeps about your account, the day you downloaded it.

Each part comes twice:
- a .json file: exactly what is stored, one object per row;
- a .csv file: the same rows, for a spreadsheet. Lists and nested values are written as JSON.

Notes:
- Amounts are in the currency the row names, or your account currency (see profile).
- Dates and times are in UTC (ISO 8601) unless the row names a time zone.
- Rows point at each other by id: for example investment_transactions.investment_account_id is an
  id in investment_accounts, and import_expenses links your statement imports to your expenses.
- To-dos and calendar events belong to your family. You get the ones you created, were given or
  attend, without other members' details.
- Secrets are left out on purpose: no access-token or calendar-link codes, and no push keys.
- picture.webp is your profile picture, if you have one.
`;

const SECTION_FILES = EXPORT_SECTIONS.flatMap((section) => [`${section}.json`, `${section}.csv`]);

/** Every file name the archive can hold, in order (the picture only when there is one). */
export const EXPORT_FILES = ["README.txt", ...SECTION_FILES, "picture.webp"] as const;

/** A spreadsheet program runs a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: text is quoted when it needs to be and kept from running as a formula. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The rows as CSV: a header with every column any row has, in the order they first appear, then one
 * line per row. No rows is an empty file.
 */
export function toCsv(rows: readonly ExportRow[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0) return "";
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

function addFile(zip: Zip, name: string, data: Uint8Array, compress = true) {
  const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
  zip.add(file);
  file.push(data, true);
}

export type ExportArchive = {
  /** Reads one section of the user's data; the stream calls it once per section, in order. */
  readSection: (section: ExportSection) => Promise<ExportRow[]>;
  /** The profile picture's WebP bytes, or null. */
  picture: Uint8Array | null;
};

/**
 * The ZIP as a stream. If a section can't be read, the stream errors, so the download fails instead
 * of ending with a partial archive that looks complete.
 */
export function exportArchiveStream({ readSection, picture }: ExportArchive): ReadableStream<Uint8Array> {
  let zip: Zip | null = null;
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let failed = false;
      zip = new Zip((error, chunk, final) => {
        if (failed) return;
        if (error) {
          failed = true;
          controller.error(new Error("Unable to prepare your data."));
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      try {
        addFile(zip, "README.txt", strToU8(README));
        for (const section of EXPORT_SECTIONS) {
          const rows = await readSection(section);
          // The browser went away: stop reading the database.
          if (cancelled) return;
          addFile(zip, `${section}.json`, strToU8(`${JSON.stringify(rows, null, 2)}\n`));
          addFile(zip, `${section}.csv`, strToU8(toCsv(rows)));
        }
        // Already compressed.
        if (picture) addFile(zip, "picture.webp", picture, false);
        zip.end();
      } catch {
        failed = true;
        zip.terminate();
        if (!cancelled) controller.error(new Error("Unable to prepare your data."));
      }
    },
    cancel() {
      cancelled = true;
      zip?.terminate();
    },
  });
}
