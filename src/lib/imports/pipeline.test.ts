import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statementHash } from "@/lib/imports/hash";
import { STATEMENT_PARSERS, UnrecognisedLayoutError, type StatementParser } from "@/lib/imports/parser";
import { buildDraft } from "@/lib/imports/pipeline";
import {
  IMPORT_CONTENT_HASH_PATTERN,
  IMPORT_DESCRIPTION_MAX_LENGTH,
  IMPORT_MAX_ROWS,
  IMPORT_NOTES_MAX_LENGTH,
  ImportError,
} from "@/lib/imports/types";
import { buildTextPdf } from "@/test/pdf";

const encode = (value: string) => new TextEncoder().encode(value);
const csv = (...lines: string[]) => ({ kind: "csv" as const, bytes: encode(`${lines.join("\n")}\n`) });

const HEADER = "Date,Description,Amount,Currency";

async function refusal(run: () => unknown): Promise<ImportError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error("expected the pipeline to refuse");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildDraft", () => {
  it("turns a CSV into a batch and its debit rows, in statement order", async () => {
    const draft = await buildDraft(
      csv(
        HEADER,
        "2026-09-01,Corner Cafe,-4.50,RON",
        "2026-09-02,Fresh Market,-123.40,RON",
        "2026-09-30,Pharmacy Green,-37.25,RON",
      ),
    );

    expect(draft.rows).toEqual([
      { expense_date: "2026-09-01", description: "Corner Cafe", amount: 4.5, currency: "RON", notes: null },
      { expense_date: "2026-09-02", description: "Fresh Market", amount: 123.4, currency: "RON", notes: null },
      { expense_date: "2026-09-30", description: "Pharmacy Green", amount: 37.25, currency: "RON", notes: null },
    ]);
    expect(draft.batch).toEqual({
      source_kind: "csv",
      parser_id: "generic-csv",
      content_hash: expect.stringMatching(IMPORT_CONTENT_HASH_PATTERN),
      currency: "RON",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      skipped_credits: 0,
    });
    expect(draft.warnings).toEqual([]);
  });

  it("drops the credits and counts them", async () => {
    const draft = await buildDraft(
      csv(HEADER, "2026-09-01,Corner Cafe,-4.50,RON", "2026-09-03,Salary,2500,RON", "2026-09-04,Refund Shop,12.00,RON"),
    );

    expect(draft.rows.map((row) => row.description)).toEqual(["Corner Cafe"]);
    expect(draft.batch.skipped_credits).toBe(2);
  });

  it("decodes a UTF-16 file and a BOM-prefixed one", async () => {
    const text = `${HEADER}\n2026-09-01,Corner Cafe,-4.50,RON\n`;
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    [...text].forEach((char, index) => {
      utf16[2 + index * 2] = char.charCodeAt(0);
    });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(text)]);

    for (const bytes of [utf16, bom]) {
      expect((await buildDraft({ kind: "csv", bytes })).rows.map((row) => row.description)).toEqual(["Corner Cafe"]);
    }
  });

  it("masks an IBAN and a card number in a description", async () => {
    const draft = await buildDraft(
      csv(
        HEADER,
        "2026-09-01,Transfer to RO00 FAKE 0000 0000 0000 0001 rent,-500.00,RON",
        "2026-09-02,Card 4111111111111111 shop,-9.99,RON",
      ),
    );

    expect(draft.rows[0].description).toBe("Transfer to …0001 rent");
    expect(draft.rows[1].description).toBe("Card …1111 shop");
    expect(JSON.stringify(draft)).not.toContain("RO00");
    expect(JSON.stringify(draft)).not.toContain("4111");
  });

  it("keeps a description of exactly 120 characters whole", async () => {
    const description = "a".repeat(IMPORT_DESCRIPTION_MAX_LENGTH);

    const draft = await buildDraft(csv(HEADER, `2026-09-01,${description},-1.00,RON`));

    expect(draft.rows[0]).toMatchObject({ description, notes: null });
  });

  it("moves the tail of a 200-character description to the notes", async () => {
    const description = `${"a".repeat(100)}${"b".repeat(100)}`;

    const draft = await buildDraft(csv(HEADER, `2026-09-01,${description},-1.00,RON`));

    expect(draft.rows[0].description).toBe(description.slice(0, 120));
    expect(draft.rows[0].notes).toBe(description.slice(120));
    expect(draft.warnings).toEqual([]);
  });

  it("masks before it splits, so an IBAN across the 120th character is still masked", async () => {
    const description = `${"x ".repeat(55)}RO00 FAKE 0000 0000 0000 0001 end`;

    const draft = await buildDraft(csv(HEADER, `2026-09-01,${description},-1.00,RON`));

    const [row] = draft.rows;
    expect(`${row.description} ${row.notes ?? ""}`).not.toContain("FAKE");
    expect(`${row.description} ${row.notes ?? ""}`).toContain("…0001");
    expect(row.description.length).toBeLessThanOrEqual(IMPORT_DESCRIPTION_MAX_LENGTH);
  });

  it("clips notes at 500 characters, says so, and never splits an emoji", async () => {
    const description = `${"a".repeat(119)}${"😀".repeat(400)}`;

    const draft = await buildDraft(csv(HEADER, `2026-09-01,${description},-1.00,RON`));

    const [row] = draft.rows;
    expect(row.description).toBe("a".repeat(119));
    expect(row.notes!.length).toBeLessThanOrEqual(IMPORT_NOTES_MAX_LENGTH);
    expect(row.notes).toBe("😀".repeat(250));
    expect(draft.warnings).toEqual(["1 description was too long to keep whole; the end was cut."]);
  });

  it("collapses whitespace in a description", async () => {
    const draft = await buildDraft(csv(HEADER, `2026-09-01,"Corner\n  Cafe",-1.00,RON`));

    expect(draft.rows[0].description).toBe("Corner Cafe");
  });

  it("accepts exactly 500 debits and refuses 501", async () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => `2026-09-01,Shop ${index},-1.00,RON`);

    expect((await buildDraft(csv(HEADER, ...rows(IMPORT_MAX_ROWS)))).rows).toHaveLength(IMPORT_MAX_ROWS);
    const error = await refusal(() => buildDraft(csv(HEADER, ...rows(IMPORT_MAX_ROWS + 1))));
    expect(error).toMatchObject({ code: "too_many_rows", status: 422 });
  });

  it("counts debits, not credits, against the 500-row limit", async () => {
    const debits = Array.from({ length: 300 }, (_, index) => `2026-09-01,Shop ${index},-1.00,RON`);
    const credits = Array.from({ length: 300 }, (_, index) => `2026-09-02,Pay ${index},1.00,RON`);

    const draft = await buildDraft(csv(HEADER, ...debits, ...credits));

    expect(draft.rows).toHaveLength(300);
    expect(draft.batch.skipped_credits).toBe(300);
  });

  it("refuses a statement with no debits", async () => {
    const error = await refusal(() => buildDraft(csv(HEADER, "2026-09-03,Salary,2500,RON")));

    expect(error).toMatchObject({ code: "no_debits", status: 422 });
  });

  it("refuses a statement with a header and no rows", async () => {
    const error = await refusal(() => buildDraft(csv(HEADER)));

    expect(error.code).toBe("no_debits");
  });

  it("refuses a layout no parser recognises", async () => {
    const error = await refusal(() => buildDraft(csv("Name,Colour", "Ann,Red")));

    expect(error).toBeInstanceOf(UnrecognisedLayoutError);
    expect(error).toMatchObject({ code: "unrecognised_layout", status: 422 });
  });

  it("refuses ambiguous amounts without guessing", async () => {
    const error = await refusal(() => buildDraft(csv("Date,Description,Amount,Currency", "2026-09-01,Shop,-1.234,RON")));

    expect(error).toMatchObject({ code: "ambiguous_amounts", status: 422 });
  });

  describe("a PDF", () => {
    // No bank parser exists yet (I13), so these tests register a throwaway one for text PDFs, in front
    // of the real ones, and take it out again.
    const pdfParser: StatementParser = {
      id: "test-pdf",
      label: "Test PDF",
      kinds: ["pdf"],
      matches: (source) => source.kind === "pdf" && source.pages[0]?.[0] === "Test bank statement",
      parse: (source) => {
        if (source.kind !== "pdf") throw new Error("expected a PDF");
        const rows = source.pages.flat().filter((line) => line.split("\t").length === 3 && /^\d{4}-/.test(line));
        return {
          parserId: "test-pdf",
          rows: rows.map((line) => {
            const [expenseDate, description, amount] = line.split("\t");
            const value = Number(amount);
            return { expenseDate, description, amount: Math.abs(value), currency: "RON", direction: value < 0 ? "debit" : "credit" };
          }),
        };
      },
    };

    beforeEach(() => {
      (STATEMENT_PARSERS as StatementParser[]).unshift(pdfParser);
    });

    afterEach(() => {
      (STATEMENT_PARSERS as StatementParser[]).splice((STATEMENT_PARSERS as StatementParser[]).indexOf(pdfParser), 1);
    });

    const table = (...rows: string[][]) =>
      buildTextPdf([["Test bank statement", ["Date", "Description", "Amount"], ...rows]], { columnWidth: 240 });

    it("is read into pages of lines and handed to the parser, then becomes a draft like a CSV", async () => {
      const draft = await buildDraft({
        kind: "pdf",
        bytes: table(
          ["2026-09-01", "Corner Cafe", "-4.50"],
          ["2026-09-03", "Salary", "2500.00"],
          ["2026-09-02", "Fresh Market", "-123.40"],
        ),
      });

      expect(draft.batch).toMatchObject({ source_kind: "pdf", parser_id: "test-pdf", skipped_credits: 1, currency: "RON" });
      expect(draft.rows.map((row) => [row.expense_date, row.description, row.amount])).toEqual([
        ["2026-09-01", "Corner Cafe", 4.5],
        ["2026-09-02", "Fresh Market", 123.4],
      ]);
      expect(draft.batch.content_hash).toMatch(IMPORT_CONTENT_HASH_PATTERN);
    });

    it("gets the same hash as the same rows from a CSV, so the two don't import the same statement twice", async () => {
      const fromPdf = await buildDraft({
        kind: "pdf",
        bytes: table(["2026-09-01", "Corner Cafe", "-4.50"], ["2026-09-02", "Fresh Market", "-123.40"]),
      });
      const fromCsv = await buildDraft(csv(HEADER, "2026-09-01,Corner Cafe,-4.50,RON", "2026-09-02,Fresh Market,-123.40,RON"));

      expect(fromPdf.batch.content_hash).toBe(fromCsv.batch.content_hash);
    });

    it("masks an IBAN read from the PDF", async () => {
      const draft = await buildDraft({
        kind: "pdf",
        bytes: table(["2026-09-01", "Transfer RO00 FAKE 0000 0000 0000 0001", "-500.00"]),
      });

      expect(draft.rows[0].description).toBe("Transfer …0001");
    });

    it.each([
      ["a password-protected PDF", () => buildTextPdf([["Test bank statement"]], { encrypted: true }), "encrypted_pdf"],
      ["a scan", () => buildTextPdf([[]], { imageOnly: true }), "no_text"],
      ["a PDF of 31 pages", () => buildTextPdf(Array.from({ length: 31 }, () => ["Test bank statement"])), "too_many_pages"],
      ["a truncated PDF", () => buildTextPdf([["Test bank statement"]]).subarray(0, 120), "unreadable_statement"],
    ])("refuses %s with its own message", async (_name, build, code) => {
      const error = await refusal(() => buildDraft({ kind: "pdf", bytes: build() }));

      expect(error).toMatchObject({ code, status: 422 });
    });
  });

  it("refuses a PDF no parser recognises as an unrecognised layout", async () => {
    const error = await refusal(() => buildDraft({ kind: "pdf", bytes: buildTextPdf([["Some other bank", "Page 1"]]) }));

    expect(error).toBeInstanceOf(UnrecognisedLayoutError);
    expect(error).toMatchObject({ code: "unrecognised_layout", status: 422 });
  });

  describe("the currency", () => {
    it("is the statement's when it has one", async () => {
      expect((await buildDraft(csv(HEADER, "2026-09-01,Shop,-1.00,EUR"))).batch.currency).toBe("EUR");
    });

    it("is the debits' single currency when a credit is in another", async () => {
      const draft = await buildDraft(csv(HEADER, "2026-09-01,Shop,-1.00,RON", "2026-09-02,Gift,5.00,EUR"));

      expect(draft.batch.currency).toBe("RON");
    });

    it("is null when the debits are in several currencies, and each row keeps its own", async () => {
      const draft = await buildDraft(csv(HEADER, "2026-09-01,Shop,-1.00,RON", "2026-09-02,Hotel,-50.00,EUR"));

      expect(draft.batch.currency).toBeNull();
      expect(draft.rows.map((row) => row.currency)).toEqual(["RON", "EUR"]);
    });
  });

  describe("the content hash", () => {
    const rows = ["2026-09-01,Corner Cafe,-4.50,RON", "2026-09-02,Fresh Market,-123.40,RON"];

    it("is the same for the same rows in another order, or from a re-download with other spacing", async () => {
      const first = (await buildDraft(csv(HEADER, ...rows))).batch.content_hash;
      const reordered = (await buildDraft(csv(HEADER, ...[...rows].reverse()))).batch.content_hash;
      const redownload = (
        await buildDraft(
          csv("Date;Description;Amount;Currency", "2026-09-01;corner  CAFE;-4,50;RON", "2026-09-02;Fresh Market;-123,40;RON"),
        )
      ).batch.content_hash;

      expect(reordered).toBe(first);
      expect(redownload).toBe(first);
    });

    it("does not change when credits are added, and changes with one cent", async () => {
      const first = (await buildDraft(csv(HEADER, ...rows))).batch.content_hash;
      const withCredit = (await buildDraft(csv(HEADER, ...rows, "2026-09-03,Salary,2500,RON"))).batch.content_hash;
      const oneCent = (await buildDraft(csv(HEADER, rows[0], "2026-09-02,Fresh Market,-123.41,RON"))).batch.content_hash;

      expect(withCredit).toBe(first);
      expect(oneCent).not.toBe(first);
    });

    it("is statementHash of the debits with their masked descriptions", async () => {
      const draft = await buildDraft(csv(HEADER, "2026-09-01,Pay RO00 FAKE 0000 0000 0000 0001,-4.50,RON"));

      expect(draft.batch.content_hash).toBe(
        statementHash([{ expenseDate: "2026-09-01", description: "Pay …0001", amount: 4.5, currency: "RON" }]),
      );
    });
  });

  describe("nothing from the file leaks", () => {
    const SECRET = "ZZSECRETMERCHANTZZ";

    it("logs nothing and puts no row text in the error when a row can't be read", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );

      const error = await refusal(() => buildDraft(csv(HEADER, `not-a-date,${SECRET},-4.50,RON`)));

      expect(error.code).toBe("unreadable_statement");
      expect(error.message).not.toContain(SECRET);
      expect(error.stack ?? "").not.toContain(SECRET);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it("logs nothing on success, and on every other refusal", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );

      await buildDraft(csv(HEADER, `2026-09-01,${SECRET},-4.50,RON`));
      for (const lines of [[HEADER, `2026-09-01,${SECRET},4.50,RON`], [`Name,${SECRET}`, "a,b"]]) {
        const error = await refusal(() => buildDraft(csv(...lines)));
        expect(error.message).not.toContain(SECRET);
      }

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });

    it("turns an unexpected failure into a plain unreadable_statement", async () => {
      const decoder = vi.spyOn(globalThis, "TextDecoder").mockImplementation(() => {
        throw new Error(`boom ${SECRET}`);
      });

      const error = await refusal(() => buildDraft(csv(HEADER, "2026-09-01,Shop,-1.00,RON")));
      decoder.mockRestore();

      expect(error).toMatchObject({ code: "unreadable_statement", status: 422 });
      expect(error.message).not.toContain(SECRET);
    });
  });
});
