import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { decodeStatementText } from "@/lib/imports/decode";
import { claimingParsers, parseStatement } from "@/lib/imports/parser";
import { maskAccountNumbers } from "@/lib/imports/redact";
import { ImportError } from "@/lib/imports/types";

/**
 * Walks every folder under `__fixtures__` (one folder per parser id, one `<name>.csv` and one
 * `<name>.expected.json` per fixture) and checks that each file parses to its expected rows, that
 * exactly the parser it is filed under claims it, and that no real-looking account number was
 * committed by accident. An expected file is either the `ParsedStatement` itself or
 * `{ "error": "<import error code>" }`.
 */

const FIXTURES_DIR = fileURLToPath(new URL("./__fixtures__", import.meta.url));

/** An invented IBAN is written `XX00 FAKE …` (digits after FAKE); a fake digit run is one repeated digit. */
const FAKE_IBAN = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2} ?FAKE[\d ]*\d/g;
const FAKE_DIGIT_RUN = /(?<!\d)(\d)\1{11,}(?!\d)/g;

/**
 * True when the text holds an IBAN-shaped string or a run of 12 or more digits (what
 * `maskAccountNumbers` would mask) that isn't one of the marked fake values.
 */
function holdsUnmarkedAccountNumber(text: string): boolean {
  const withoutFakes = text.replace(FAKE_IBAN, " ").replace(FAKE_DIGIT_RUN, " ");
  return maskAccountNumbers(withoutFakes) !== withoutFakes;
}

type Fixture = { folder: string; name: string; csv: Uint8Array; expected: Record<string, unknown> };

const folders = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const fixtures: Fixture[] = folders.flatMap((folder) => {
  const files = readdirSync(join(FIXTURES_DIR, folder)).sort();
  return files
    .filter((file) => file.endsWith(".csv"))
    .map((file) => {
      const name = file.slice(0, -".csv".length);
      return {
        folder,
        name,
        csv: readFileSync(join(FIXTURES_DIR, folder, file)),
        expected: JSON.parse(readFileSync(join(FIXTURES_DIR, folder, `${name}.expected.json`), "utf8")),
      };
    });
});

describe("holdsUnmarkedAccountNumber", () => {
  it("flags real-looking account numbers", () => {
    expect(holdsUnmarkedAccountNumber("To GB29 NWBK 6016 1331 9268 19")).toBe(true);
    expect(holdsUnmarkedAccountNumber("RO49AAAA1B31007593840000")).toBe(true);
    expect(holdsUnmarkedAccountNumber("Card 4111111111111111")).toBe(true);
    expect(holdsUnmarkedAccountNumber("Ref 123456789012")).toBe(true);
    expect(holdsUnmarkedAccountNumber("Card 4111 1111 1111 1111")).toBe(true);
  });

  it("accepts the marked fake values", () => {
    expect(holdsUnmarkedAccountNumber("To RO00 FAKE 0000 0000 0000 0001 rent")).toBe(false);
    expect(holdsUnmarkedAccountNumber("RO00FAKE0000000000000000")).toBe(false);
    expect(holdsUnmarkedAccountNumber("Ref 000000000000 insurance")).toBe(false);
  });

  it("flags a real number next to a fake one", () => {
    expect(holdsUnmarkedAccountNumber("RO00 FAKE 0000 0001 and GB29 NWBK 6016 1331 9268 19")).toBe(true);
    expect(holdsUnmarkedAccountNumber("000000000000 then 123456789012")).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    expect(holdsUnmarkedAccountNumber("Invoice 2026-10 RO")).toBe(false);
    expect(holdsUnmarkedAccountNumber("2026-09-01,Shop,-1234567.89,RON")).toBe(false);
  });
});

describe("statement fixtures", () => {
  it("exist for the generic CSV parser", () => {
    expect(folders).toContain("generic-csv");
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it("have an expected file each, and no stray expected files", () => {
    for (const folder of folders) {
      const files = readdirSync(join(FIXTURES_DIR, folder));
      const csvs = files.filter((file) => file.endsWith(".csv")).map((file) => file.slice(0, -4));
      const expecteds = files
        .filter((file) => file.endsWith(".expected.json"))
        .map((file) => file.slice(0, -".expected.json".length));
      expect(expecteds.sort()).toEqual(csvs.sort());
      expect(files.length).toBe(csvs.length + expecteds.length);
    }
  });

  describe.each(fixtures)("$folder/$name", ({ folder, csv, expected }) => {
    const text = decodeStatementText(csv);

    it("parses to its expected rows, or is refused with its expected code", () => {
      if (typeof expected.error === "string") {
        let error: unknown;
        try {
          parseStatement({ kind: "csv", text });
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(ImportError);
        expect((error as ImportError).code).toBe(expected.error);
      } else {
        expect(parseStatement({ kind: "csv", text })).toEqual(expected);
      }
    });

    it("is claimed by its own parser only, or by none when its layout is unrecognised", () => {
      const claimants = claimingParsers({ kind: "csv", text }).map((parser) => parser.id);
      expect(claimants).toEqual(expected.error === "unrecognised_layout" ? [] : [folder]);
    });

    it("holds no unmarked IBAN or long digit run", () => {
      expect(holdsUnmarkedAccountNumber(text)).toBe(false);
      expect(holdsUnmarkedAccountNumber(JSON.stringify(expected))).toBe(false);
    });
  });

  it("covers the encodings and line ends the parser has to handle", () => {
    const bytes = fixtures.map((fixture) => fixture.csv);
    const startsWith = (file: Uint8Array, ...prefix: number[]) => prefix.every((byte, i) => file[i] === byte);
    const asLatin1 = (file: Uint8Array) => Buffer.from(file).toString("latin1");

    expect(bytes.some((file) => startsWith(file, 0xef, 0xbb, 0xbf))).toBe(true);
    expect(bytes.some((file) => startsWith(file, 0xff, 0xfe))).toBe(true);
    expect(bytes.some((file) => asLatin1(file).includes("\r\n"))).toBe(true);
    expect(bytes.some((file) => asLatin1(file).includes("\t"))).toBe(true);
    expect(
      bytes.some((file) => {
        try {
          new TextDecoder("utf-8", { fatal: true }).decode(file);
          return false;
        } catch {
          return !startsWith(file, 0xff, 0xfe);
        }
      }),
    ).toBe(true);
  });

  it("scans every other file in the fixtures folders too", () => {
    for (const folder of folders) {
      for (const file of readdirSync(join(FIXTURES_DIR, folder))) {
        const text = file.endsWith(".csv")
          ? decodeStatementText(readFileSync(join(FIXTURES_DIR, folder, file)))
          : readFileSync(join(FIXTURES_DIR, folder, file), "utf8");
        expect(holdsUnmarkedAccountNumber(text), `${folder}/${file}`).toBe(false);
      }
    }
  });
});
