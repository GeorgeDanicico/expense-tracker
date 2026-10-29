import { describe, expect, it } from "vitest";

import { genericCsvParser } from "@/lib/imports/parsers/generic-csv";
import { ImportError, type ParsedStatement } from "@/lib/imports/types";

const csv = (...lines: string[]) => ({ kind: "csv" as const, text: lines.join("\n") + "\n" });
const matches = (...lines: string[]) => genericCsvParser.matches(csv(...lines));
const parse = (...lines: string[]): ParsedStatement => genericCsvParser.parse(csv(...lines));

function refusal(run: () => unknown): ImportError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error("expected an ImportError");
}

describe("genericCsvParser.matches", () => {
  it("matches a date, a description and an amount column", () => {
    expect(matches("Date,Description,Amount,Currency")).toBe(true);
  });

  it("matches a date, a description and a debit column", () => {
    expect(matches("Date;Description;Debit;Credit")).toBe(true);
    expect(matches("Date;Description;Debit")).toBe(true);
  });

  it("compares header names ignoring case, accents, spacing and punctuation", () => {
    expect(matches("  DATE ,Transaction-Details, AMOUNT ")).toBe(true);
    expect(matches("Booking Date;Payee;Transaction amount")).toBe(true);
    expect(matches("Posting_date;Narrative;Paid out;Paid in")).toBe(true);
  });

  it("finds the header among the first 20 records and no later", () => {
    const preamble = (count: number) => Array.from({ length: count }, (_, i) => `Note ${i}`);
    expect(matches(...preamble(19), "Date,Description,Amount")).toBe(true);
    expect(matches(...preamble(20), "Date,Description,Amount")).toBe(false);
  });

  it("needs all three roles", () => {
    expect(matches("Date,Amount,Balance")).toBe(false);
    expect(matches("Description,Amount")).toBe(false);
    expect(matches("Date,Description")).toBe(false);
    expect(matches("Date,Description,Credit")).toBe(false);
  });

  it("matches by name only, never by position", () => {
    expect(matches("Col A,Col B,Col C", "2026-09-01,Shop,-4.50")).toBe(false);
    expect(matches("Reference,Booked,Info,Total", "1,2026-09-01,Shop,-4.50")).toBe(false);
  });

  it("does not take a value date for a date", () => {
    expect(matches("Value date,Description,Amount")).toBe(false);
  });

  it("matches only CSV sources", () => {
    expect(
      genericCsvParser.matches({ kind: "pdf", text: "Date,Description,Amount", pages: [["Date,Description,Amount"]] }),
    ).toBe(false);
  });

  it("looks only at the first records", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `2026-09-01,Shop ${i},-1.00`);
    // An unclosed quote far below the header must not stop the match.
    expect(matches("Date,Description,Amount", ...rows, '2026-09-02,"never closed,-1.00')).toBe(true);
  });

  it("matches nothing in an empty text", () => {
    expect(genericCsvParser.matches({ kind: "csv", text: "" })).toBe(false);
  });
});

describe("genericCsvParser.parse: signed amounts", () => {
  it("takes negative amounts as debits and positive ones as credits", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,Shop,-45.20,RON",
      "2026-09-02,Refund,10.00,RON",
    );
    expect(statement.rows).toEqual([
      { expenseDate: "2026-09-01", description: "Shop", amount: 45.2, currency: "RON", direction: "debit" },
      { expenseDate: "2026-09-02", description: "Refund", amount: 10, currency: "RON", direction: "credit" },
    ]);
  });

  it("describes the statement: parser, currency and period", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-20,Late,-1.00,RON",
      "2026-09-02,Early,-2.00,RON",
    );
    expect(statement).toMatchObject({
      parserId: "generic-csv",
      currency: "RON",
      periodStart: "2026-09-02",
      periodEnd: "2026-09-20",
    });
  });

  it("leaves the statement currency out when the rows have two", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,A,-1.00,RON",
      "2026-09-02,B,-1.00,EUR",
    );
    expect(statement.currency).toBeUndefined();
    expect(statement.rows.map((row) => row.currency)).toEqual(["RON", "EUR"]);
  });

  it("reads trailing minus, parentheses, a plus and thousands groups", () => {
    const statement = parse(
      "Date;Description;Amount;Currency",
      "01.09.2026;A;45,20-;RON",
      "02.09.2026;B;(12,00);RON",
      "03.09.2026;C;+7,50;RON",
      "04.09.2026;D;-1.234,56;RON",
    );
    expect(statement.rows.map((row) => [row.amount, row.direction])).toEqual([
      [45.2, "debit"],
      [12, "debit"],
      [7.5, "credit"],
      [1234.56, "debit"],
    ]);
  });

  it("decides the decimal mark for the whole column", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,A,\"-1,234.56\",RON",
      "2026-09-02,B,\"-2,500.00\",RON",
    );
    expect(statement.rows.map((row) => row.amount)).toEqual([1234.56, 2500]);
  });

  it("uses the first column of a role when a header repeats", () => {
    const statement = parse("Date,Description,Amount,Amount,Currency", "2026-09-01,A,-1.00,-2.00,RON");
    expect(statement.rows[0].amount).toBe(1);
  });

  it("prefers an amount column over debit and credit columns", () => {
    const statement = parse(
      "Date,Description,Amount,Debit,Credit,Currency",
      "2026-09-01,A,-5.00,99.00,,RON",
    );
    expect(statement.rows).toHaveLength(1);
    expect(statement.rows[0]).toMatchObject({ amount: 5, direction: "debit" });
  });
});

describe("genericCsvParser.parse: debit and credit columns", () => {
  it("reads money out from Debit and money in from Credit", () => {
    const statement = parse(
      "Date,Description,Debit,Credit,Currency",
      "2026-09-01,Shop,45.20,,RON",
      "2026-09-02,Salary,,2000.00,RON",
    );
    expect(statement.rows.map((row) => [row.amount, row.direction])).toEqual([
      [45.2, "debit"],
      [2000, "credit"],
    ]);
  });

  it("takes the absolute value of a signed debit", () => {
    const statement = parse("Date,Description,Debit,Credit,Currency", "2026-09-01,Shop,-45.20,,RON");
    expect(statement.rows[0]).toMatchObject({ amount: 45.2, direction: "debit" });
  });

  it("reads a debit-only file as money out", () => {
    const statement = parse("Date,Description,Debit,Currency", "2026-09-01,Shop,45.20,RON");
    expect(statement.rows[0]).toMatchObject({ amount: 45.2, direction: "debit" });
  });

  it("uses each column's own decimal mark", () => {
    const statement = parse(
      "Date;Description;Debit;Credit;Currency",
      "01.09.2026;A;1.234,50;;RON",
      "02.09.2026;B;;2.000,00;RON",
    );
    expect(statement.rows.map((row) => row.amount)).toEqual([1234.5, 2000]);
  });

  it("refuses a row with both a debit and a credit", () => {
    const error = refusal(() => parse("Date,Description,Debit,Credit,Currency", "2026-09-01,Shop,5.00,5.00,RON"));
    expect(error.code).toBe("unreadable_statement");
  });

  it("refuses a row with neither", () => {
    const error = refusal(() => parse("Date,Description,Debit,Credit,Currency", "2026-09-01,Shop,,,RON"));
    expect(error.code).toBe("unreadable_statement");
  });
});

describe("genericCsvParser.parse: dates", () => {
  it("reads every supported date form, day first", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,A,-1.00,RON",
      "02.09.2026,B,-1.00,RON",
      "03/09/2026,C,-1.00,RON",
      "04-09-2026,D,-1.00,RON",
      "2026-09-05T14:05:09Z,E,-1.00,RON",
    );
    expect(statement.rows.map((row) => row.expenseDate)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("refuses an impossible date", () => {
    const error = refusal(() => parse("Date,Description,Amount,Currency", "31.02.2026,Shop,-1.00,RON"));
    expect(error.code).toBe("unreadable_statement");
  });
});

describe("genericCsvParser.parse: currency", () => {
  it("reads a currency column in any case", () => {
    expect(parse("Date,Description,Amount,Currency", "2026-09-01,A,-1.00, eur ").rows[0].currency).toBe("EUR");
  });

  it("refuses a currency that isn't three letters", () => {
    const error = refusal(() => parse("Date,Description,Amount,Currency", "2026-09-01,A,-1.00,E1"));
    expect(error.code).toBe("unreadable_statement");
  });

  it("reads the currency from the amount when there is no currency column", () => {
    const statement = parse(
      "Date,Description,Amount",
      "2026-09-01,A,-45.20 RON",
      "2026-09-02,B,-€ 3.00",
      "2026-09-03,C,-7.00 lei",
      "2026-09-04,D,-£1.00",
    );
    expect(statement.rows.map((row) => row.currency)).toEqual(["RON", "EUR", "RON", "GBP"]);
  });

  it("refuses a statement that doesn't say its currency, without guessing one", () => {
    const error = refusal(() => parse("Date,Description,Amount", "2026-09-01,A,-1.00"));
    expect(error.code).toBe("unreadable_statement");
    expect(error.message).toBe("This statement doesn't say which currency its amounts are in.");
  });
});

describe("genericCsvParser.parse: refusals and skips", () => {
  it("refuses a column where the decimal mark can't be told", () => {
    const error = refusal(() =>
      parse("Date,Description,Amount,Currency", "2026-09-01,A,-1.234,RON", "2026-09-02,B,-2.500,RON"),
    );
    expect(error.code).toBe("ambiguous_amounts");
    expect(error.status).toBe(422);
  });

  it("refuses a column whose cells disagree about the decimal mark", () => {
    const error = refusal(() =>
      parse("Date,Description,Amount,Currency", "2026-09-01,A,-1.50,RON", "2026-09-02,B,\"-2,50\",RON"),
    );
    expect(error.code).toBe("ambiguous_amounts");
  });

  it("names the row that can't be read, never its text", () => {
    const error = refusal(() =>
      parse(
        "Date,Description,Amount,Currency",
        "2026-09-01,Fine shop,-1.00,RON",
        "2026-09-02,Secret Merchant Ltd,about ten lei,RON",
      ),
    );
    expect(error.code).toBe("unreadable_statement");
    expect(error.message).toBe("Row 2 of this statement couldn't be read.");
    expect(error.message).not.toContain("Secret");
  });

  it("refuses a row without a description", () => {
    expect(refusal(() => parse("Date,Description,Amount,Currency", "2026-09-01,  ,-1.00,RON")).code).toBe(
      "unreadable_statement",
    );
  });

  it("refuses a row with an amount but no date", () => {
    expect(refusal(() => parse("Date,Description,Amount,Currency", ",Total,-1.00,RON")).code).toBe(
      "unreadable_statement",
    );
  });

  it("skips and counts lines with neither a date nor an amount (wholly empty lines aren't counted)", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,Shop,-1.00,RON",
      ",,,",
      ",Generated by Example Bank,,",
    );
    expect(statement.rows).toHaveLength(1);
    expect(statement.warnings).toEqual(["1 line without a date or an amount skipped."]);
  });

  it("skips and counts zero amounts", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,Shop,-1.00,RON",
      "2026-09-02,Waived,0.00,RON",
    );
    expect(statement.rows).toHaveLength(1);
    expect(statement.warnings).toEqual(["1 row with a zero amount skipped."]);
  });

  it("has no warnings when nothing was skipped", () => {
    expect(parse("Date,Description,Amount,Currency", "2026-09-01,Shop,-1.00,RON").warnings).toBeUndefined();
  });

  it("returns no rows, and no period, for a header alone", () => {
    expect(parse("Date,Description,Amount,Currency")).toEqual({ parserId: "generic-csv", rows: [] });
  });

  it("refuses an amount above the limit", () => {
    expect(
      refusal(() => parse("Date,Description,Amount,Currency", "2026-09-01,Shop,-99999999999.00,RON")).code,
    ).toBe("unreadable_statement");
  });

  it("refuses an unclosed quote without quoting the file", () => {
    const error = refusal(() => parse("Date,Description,Amount,Currency", '2026-09-01,"Secret Merchant,-1.00,RON'));
    expect(error.code).toBe("unreadable_statement");
    expect(error.message).not.toContain("Secret");
  });

  it("refuses a PDF source", () => {
    expect(
      refusal(() => genericCsvParser.parse({ kind: "pdf", text: "x", pages: [["x"]] })).code,
    ).toBe("unrecognised_layout");
  });
});

describe("genericCsvParser.parse: descriptions", () => {
  it("collapses whitespace and line breaks and trims", () => {
    const statement = {
      kind: "csv" as const,
      text: 'Date,Description,Amount,Currency\n2026-09-01,"  Two\n  lines   here ",-1.00,RON\n',
    };
    expect(genericCsvParser.parse(statement).rows[0].description).toBe("Two lines here");
  });

  it("keeps an IBAN as written: masking is the pipeline's job", () => {
    const statement = parse(
      "Date,Description,Amount,Currency",
      "2026-09-01,Transfer RO00 FAKE 0000 0000 0000 0001,-1.00,RON",
    );
    expect(statement.rows[0].description).toBe("Transfer RO00 FAKE 0000 0000 0000 0001");
  });
});
