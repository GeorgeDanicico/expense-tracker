import { describe, expect, it } from "vitest";

import { getBucharestToday } from "@/lib/calendar";
import { numberStatement } from "@/lib/imports/ai/numbered-text";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import { verifyReading } from "@/lib/imports/ai/verify";

/** A synthetic statement as a CSV, so line numbers are easy to count: line 1 is the header. */
function statement(...lines: string[]) {
  return numberStatement({ kind: "csv", text: ["Date,Details,Amount (RON)", ...lines].join("\n") });
}

/** A synthetic statement as a PDF would give it: one line each, columns separated by tabs. */
const pdf = (...lines: string[]) => numberStatement({ kind: "pdf", text: lines.join("\n"), pages: [lines] });

type Row = ReaderAnswer["r"][number];

/** A row as the model returns it: the date as YYYY-MM-DD and the amount as a plain decimal. */
const row = (overrides: Partial<Row> = {}): Row => ({ l: [2], d: "2026-10-02", a: "4.50", c: null, t: "d", m: "Corner Cafe", ...overrides });

function answer(rows: Row[], overrides: Partial<ReaderAnswer> = {}): ReaderAnswer {
  return {
    r: rows,
    k: [...new Set(rows.map((entry) => entry.m))].map((m) => ({ m, c: "other" as const, s: null })),
    s: { c: "RON", t: null, l: null },
    ...overrides,
  };
}

function failureOf(result: ReturnType<typeof verifyReading>) {
  if (result.ok) throw new Error("expected the reading to fail verification");
  return result;
}

function okOf(result: ReturnType<typeof verifyReading>) {
  if (!result.ok) throw new Error(`expected the reading to hold up, but it failed on ${result.reason}`);
  return result;
}

describe("verifyReading: what is accepted", () => {
  it("returns typed rows: the model's date and amount, found in the text, and its cleaned merchant", () => {
    const result = verifyReading(answer([row()]), statement("2026-10-02,POS 4411 CORNER CAFE RO,-4.50"));

    expect(result).toEqual({
      ok: true,
      rows: [{ expenseDate: "2026-10-02", description: "Corner Cafe", amount: 4.5, currency: "RON", direction: "debit", suggestion: { category: "other", subtype: null } }],
      currency: "RON",
      warnings: [],
      dropped: [],
    });
  });

  it("finds an amount however the statement groups it, and keeps its direction from t", () => {
    const text = statement("02.10.2026;CORNER CAFE;-1.234,56", "03.10.2026;SALARY;2.500,00");
    const result = verifyReading(
      answer([
        row({ d: "2026-10-02", a: "1234.56" }),
        row({ l: [3], d: "2026-10-03", a: "2500.00", t: "c", m: "Salary" }),
      ]),
      text,
    );

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 1234.56, direction: "debit" }, { amount: 2500, direction: "credit" }] });
  });

  it("accepts a transaction on up to three consecutive lines, citing words from any of them", () => {
    const text = statement("2026-10-02,CARD PAYMENT,-9.00", "PHARMACY", "GREEN CLUJ");

    const result = verifyReading(answer([row({ l: [2, 3, 4], a: "9.00", m: "Pharmacy Green Cluj" })]), text);

    expect(result.ok).toBe(true);
  });

  it("takes the merchant as the model cleaned it, even with words that are not on the lines", () => {
    const result = verifyReading(answer([row({ m: "Corner Café" })]), statement("2026-10-02,POS 4411 CORNER CAFE RO,-4.50"));

    expect(result).toMatchObject({ ok: true, rows: [{ description: "Corner Café" }] });
  });

  it("skips a zero amount with a warning, as the CSV parser does", () => {
    const result = verifyReading(answer([row({ a: "0.00" })]), statement("2026-10-02,Corner Cafe,0.00"));

    expect(result).toMatchObject({ ok: true, rows: [], warnings: ["1 row with a zero amount skipped."] });
  });

  it("takes the statement's currency for a row that names none, only when the text bears it out", () => {
    const text = statement("2026-10-02,Corner Cafe,-4.50 lei");

    expect(verifyReading(answer([row()]), text)).toMatchObject({ ok: true, currency: "RON", rows: [{ currency: "RON" }] });
    expect(failureOf(verifyReading(answer([row()], { s: { c: "USD", t: null, l: null } }), text)).reason).toBe("no_currency");
    expect(failureOf(verifyReading(answer([row()], { s: { c: null, t: null, l: null } }), text)).reason).toBe("no_currency");
  });

  it("accepts a currency symbol as proof of the code", () => {
    const result = verifyReading(answer([row({ c: "EUR" })]), statement("2026-10-02,Corner Cafe,€4.50"));

    expect(result).toMatchObject({ ok: true, rows: [{ currency: "EUR" }] });
  });

  it("finds nothing wrong with a statement that has no transactions", () => {
    expect(verifyReading(answer([]), statement("Opening balance"))).toEqual({ ok: true, rows: [], currency: null, warnings: [], dropped: [] });
  });

  it("refuses a model that found nothing in a statement full of transactions", () => {
    expect(failureOf(verifyReading(answer([]), statement("2026-10-02,Corner Cafe,-4.50"))).reason).toBe("no_rows");
  });
});

// ---------------------------------------------------------------------------------------------
// The amount: found on a cited line, to the cent
// ---------------------------------------------------------------------------------------------

describe("verifyReading: the amount is found to the cent", () => {
  it.each([
    ["1.234,56", "-1.234,56"],
    ["1,234.56", "-1,234.56"],
    ['"1 234,56"', "1 234,56"],
    ["1\u00a0234,56 with a non-breaking space", "1\u00a0234,56 RON"],
    ["1234.56", "1234.56"],
    ["1234,56", "1234,56"],
  ])("reads the model's 1234.56 in %s", (_name, printed) => {
    const result = verifyReading(answer([row({ a: "1234.56" })]), pdf("Moneda: RON", `02.10.2026\tCorner Cafe\t${printed}`));

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 1234.56 }] });
  });

  it("reads the model's 1234.56 in a quoted CSV field too", () => {
    const text = numberStatement({ kind: "csv", text: 'Data;Detalii;Suma RON\n02.10.2026;Corner Cafe;"1 234,56"\n' });

    expect(verifyReading(answer([row({ a: "1234.56" })]), text)).toMatchObject({ ok: true, rows: [{ amount: 1234.56 }] });
  });

  it("reads a number that could be either mark both ways: 1.234 is 1234, never 1.23", () => {
    const text = statement("02.10.2026;Corner Cafe;1.234");

    expect(verifyReading(answer([row({ a: "1234.00" })]), text)).toMatchObject({ ok: true, rows: [{ amount: 1234 }] });
    expect(failureOf(verifyReading(answer([row({ a: "1.23" })]), text)).reason).toBe("amount_not_found");
  });

  it("accepts the amount when the model drops the cents' trailing zero: to the cent, not to the character", () => {
    expect(verifyReading(answer([row({ a: "4.5" })]), statement("2026-10-02,Corner Cafe,-4.50")).ok).toBe(true);
    expect(verifyReading(answer([row({ a: "4" })]), statement("2026-10-02,Corner Cafe,-4.50")).ok).toBe(false);
  });

  it.each([
    ["an amount inside a longer one", "45.20", "2026-10-02,Corner Cafe,-145.20"],
    ["an amount from the middle of a grouped one", "234.56", '2026-10-02,Corner Cafe,"-1,234.56"'],
    ["an amount that is only a part of a date", "12.10", "12.10.2026,Corner Cafe,-4.50"],
    ["an amount that is not there", "4.51", "2026-10-02,Corner Cafe,-4.50"],
    ["an amount a hundred times too big", "450.00", "2026-10-02,Corner Cafe,-4.50"],
  ])("does not find %s", (_name, amount, line) => {
    const text = statement(line);
    const date = line.slice(0, line.indexOf(","));
    const iso = date.includes(".") ? date.split(".").reverse().join("-") : date;

    const result = failureOf(verifyReading(answer([row({ d: iso, a: amount })]), text));

    expect(result).toMatchObject({ reason: "amount_not_found", row: 0 });
  });

  it("accepts a number that sits between other fields of a CSV line", () => {
    const text = statement("2026-10-02,Corner Cafe,-4.50,1234.56");

    expect(verifyReading(answer([row({ a: "4.50" })]), text).ok).toBe(true);
    expect(verifyReading(answer([row({ a: "1234.56" })]), text).ok).toBe(true);
  });

  it.each([
    ["a thousands separator", "1,234.56"],
    ["a decimal comma", "45,20"],
    ["a currency", "45.20 RON"],
    ["no number", "forty"],
    ["an empty string", ""],
  ])("drops an amount that is not a plain decimal: %s", (_name, amount) => {
    const text = statement("2026-10-02,Corner Cafe,-4.50");

    expect(failureOf(verifyReading(answer([row({ a: amount })]), text)).reason).toBe("amount_unreadable");
  });

  it("ignores a sign on the model's amount, since the direction is t's", () => {
    const result = verifyReading(answer([row({ a: "-4.50" })]), statement("2026-10-02,Corner Cafe,-4.50"));

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 4.5, direction: "debit" }] });
  });
});

// ---------------------------------------------------------------------------------------------
// The date: the day and month are printed on a cited line, and the year agrees
// ---------------------------------------------------------------------------------------------

describe("verifyReading: the date", () => {
  const October = ["Perioada 01.10.2026 - 31.10.2026", "Moneda: RON", "Data\tDescriere\tSuma"];
  const dated = (d: string, extra: Partial<Row> = {}) => row({ l: [4], d, a: "4.50", ...extra });

  it.each([
    ["an ISO date", "2026-10-12"],
    ["a day-first date with dots", "12.10.2026"],
    ["a day-first date with slashes", "12/10/2026"],
    ["a day-first date with dashes", "12-10-2026"],
    ["a day with an English month", "12 Oct 2026"],
    ["a day with an English month and a dot", "12 oct. 2026"],
    ["a day with an English month in full", "12 October 2026"],
    ["a day with a Romanian month in full", "12 octombrie 2026"],
    ["a day with a Romanian month, dashes", "12-Oct-2026"],
    ["a month first, with a comma", "Oct 12, 2026"],
    ["a month first, in full, without a comma", "October 12 2026"],
  ])("finds %s (%s) and keeps its year", (_name, printed) => {
    const result = verifyReading(answer([dated("2026-10-12")]), pdf(...October, `${printed}\tCORNER CAFE\t-4,50`), { today: "2030-01-01" });

    expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12", amount: 4.5 }], warnings: [] });
  });

  it("reads Romanian months with their diacritics and the longest names", () => {
    const text = pdf(...October, "12 septembrie 2026\tCORNER CAFE\t-4,50", "13 Noiembrie 2026\tCORNER CAFE\t-4,50");

    expect(verifyReading(answer([dated("2026-09-12")]), text)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-09-12" }] });
    expect(verifyReading(answer([dated("2026-11-13", { l: [5] })]), text)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-11-13" }] });
  });

  it("reads numeric dates day first: 10/12/2026 is the tenth of December and never the twelfth of October", () => {
    const text = pdf(...October, "10/12/2026\tCORNER CAFE\t-4,50");

    expect(verifyReading(answer([dated("2026-12-10")]), text)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-12-10" }] });
    expect(failureOf(verifyReading(answer([dated("2026-10-12")]), text)).reason).toBe("date_not_found");
  });

  it("refuses a date a day or a month off, and one that is on no cited line", () => {
    const text = pdf(...October, "12 Oct 2026\tCORNER CAFE\t-4,50", "13 Oct 2026\tFRESH MARKET\t-6,00");

    expect(failureOf(verifyReading(answer([dated("2026-10-13")]), text)).reason).toBe("date_not_found");
    expect(failureOf(verifyReading(answer([dated("2026-11-12")]), text)).reason).toBe("date_not_found");
    // Printed on the next line, which the row does not cite.
    expect(failureOf(verifyReading(answer([dated("2026-10-12", { l: [5], a: "6.00" })]), text)).reason).toBe("date_not_found");
  });

  it("refuses a date that is only a part of something longer", () => {
    const text = pdf(...October, "112.10\tCORNER CAFE\t-4,50", "12.10.20268\tCORNER CAFE\t-4,50", "12.10.26\tCORNER CAFE\t-4,50");

    expect(failureOf(verifyReading(answer([dated("2026-10-12")]), text)).reason).toBe("date_not_found");
    expect(failureOf(verifyReading(answer([dated("2026-10-12", { l: [5] })]), text)).reason).toBe("date_not_found");
    expect(failureOf(verifyReading(answer([dated("2026-10-12", { l: [6] })]), text)).reason).toBe("date_not_found");
  });

  it("refuses a date that is no date", () => {
    const text = pdf(...October, "12.10.2026\tCORNER CAFE\t-4,50");

    expect(failureOf(verifyReading(answer([dated("2026-13-45")]), text)).reason).toBe("date_unreadable");
    expect(failureOf(verifyReading(answer([dated("12 Oct 2026")]), text)).reason).toBe("date_unreadable");
    expect(failureOf(verifyReading(answer([dated("")]), text)).reason).toBe("date_unreadable");
  });

  it("is not fooled by a date that does not exist on the line", () => {
    const text = pdf(...October, "31.02.2026\tCORNER CAFE\t-4,50");

    expect(failureOf(verifyReading(answer([dated("2026-02-28")]), text)).reason).toBe("date_not_found");
  });

  describe("the year", () => {
    it("must be the one the line prints: a model that moves the year drops the row", () => {
      const text = pdf(...October, "12.10.2026\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("2025-10-12")]), text))).toMatchObject({ reason: "date_year_mismatch", row: 0 });
    });

    it("must match for a month name as well", () => {
      const text = pdf(...October, "12 Oct 2026\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("2025-10-12")]), text)).reason).toBe("date_year_mismatch");
    });

    it("is the printed one when the model gives a date with no year", () => {
      const text = pdf(...October, "12.10.2026\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("12.10")]), text)).reason).toBe("date_year_mismatch");
    });
  });

  describe("a date printed without a year", () => {
    it.each([
      ["12.10", "12.10\tCORNER CAFE\t-4,50"],
      ["12/10", "12/10\tCORNER CAFE\t-4,50"],
      ["12.10.", "12.10.\tCORNER CAFE\t-4,50"],
      ["12 Oct", "12 Oct\tCORNER CAFE\t-4,50"],
      ["12 oct.", "12 oct.\tCORNER CAFE\t-4,50"],
      ["12 octombrie", "12 octombrie\tCORNER CAFE\t-4,50"],
      ["Oct 12", "Oct 12\tCORNER CAFE\t-4,50"],
    ])("%j gets its year from code, taking it from the period the statement prints", (_printed, line) => {
      const result = verifyReading(answer([dated("2026-10-12")]), pdf(...October, line), { today: "2030-01-01" });

      expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12", amount: 4.5 }] });
    });

    it("ignores the year the model gave", () => {
      const result = verifyReading(answer([dated("2019-10-12")]), pdf(...October, "12.10\tCORNER CAFE\t-4,50"), { today: "2030-01-01" });

      expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
    });

    it("warns that the year was worked out, without quoting the statement", () => {
      const result = verifyReading(answer([dated("2026-10-12")]), pdf(...October, "12.10\tCORNER CAFE\t-4,50"));

      expect(result).toMatchObject({
        ok: true,
        warnings: ["1 date is printed without a year; the year was worked out from the statement's other dates. Check it below."],
      });
    });

    it("gives each date its year in a statement that runs over New Year", () => {
      const text = pdf(
        "Perioada 05.12.2026 - 04.01.2027",
        "Moneda: RON",
        "Data\tDescriere\tSuma",
        "28.12\tCORNER CAFE\t-4,50",
        "02.01\tCORNER CAFE\t-6,00",
      );

      const result = verifyReading(answer([dated("2026-12-28"), row({ l: [5], d: "2027-01-02", a: "6.00" })]), text);

      expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-12-28" }, { expenseDate: "2027-01-02" }] });
    });

    it("uses the full dates of other rows, in any form, when there is no heading", () => {
      const text = pdf("Moneda: RON", "2 Oct 2026\tSHOP A\t-1,00", "12.10\tCORNER CAFE\t-4,50", "30 octombrie 2026\tSHOP B\t-2,00");

      const result = verifyReading(answer([row({ l: [3], d: "2026-10-12", a: "4.50" })]), text);

      expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
    });

    describe("with no full date anywhere", () => {
      const text = pdf("Moneda: RON", "12.10\tCORNER CAFE\t-4,50", "31.10\tCORNER CAFE\t-4,50", "29.02\tCORNER CAFE\t-4,50");
      const read = (printed: string, line: number) => verifyReading(answer([row({ l: [line], d: printed, a: "4.50" })]), text, { today: "2026-10-30" });

      it("takes the most recent occurrence that is not after today", () => {
        expect(read("2026-10-12", 2)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
        expect(read("2026-10-31", 3)).toMatchObject({ ok: true, rows: [{ expenseDate: "2025-10-31" }] });
        expect(read("2026-02-28", 4)).toMatchObject({ ok: false, reason: "date_not_found" });
        expect(read("12.10", 2)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
        expect(verifyReading(answer([row({ l: [4], d: "29.02", a: "4.50" })]), text, { today: "2026-10-30" })).toMatchObject({
          ok: true,
          rows: [{ expenseDate: "2024-02-29" }],
        });
      });

      it("says so in the warning", () => {
        expect(read("2026-10-12", 2)).toMatchObject({
          warnings: ["1 date is printed without a year; the most recent year that isn't in the future was used. Check it below."],
        });
      });

      it("defaults to today in Europe/Bucharest", () => {
        const result = verifyReading(answer([row({ l: [2], d: "2026-10-12", a: "4.50" })]), text);

        expect(result.ok && result.rows[0].expenseDate <= getBucharestToday()).toBe(true);
      });
    });

    it("drops a date whose year cannot be told: a period of more than a year with the date inside it twice", () => {
      const text = pdf("Perioada 01.01.2025 - 31.12.2026", "Moneda: RON", "Data\tDescriere\tSuma", "12.10\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("2026-10-12")]), text)).reason).toBe("date_unreadable");
    });

    it("drops a day and month that do not exist: a model's 31 November is not a date", () => {
      const text = pdf(...October, "31.11\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("2026-11-31")]), text)).reason).toBe("date_unreadable");
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The lines a row cites
// ---------------------------------------------------------------------------------------------

describe("verifyReading: the lines a row cites", () => {
  const text = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Corner Cafe,-6.00", "2026-10-04,Corner Cafe,-7.00", "2026-10-05,Corner Cafe,-8.00");

  it.each([
    ["none", []],
    ["four", [2, 3, 4, 5]],
    ["one that doesn't exist", [99]],
    ["line zero", [0]],
    ["lines out of order", [3, 2]],
    ["lines that are not consecutive", [2, 4]],
    ["a fraction", [2.5]],
  ])("drops a row that cites %s", (_name, lines) => {
    expect(failureOf(verifyReading(answer([row({ l: lines })]), text)).reason).toBe("bad_lines");
  });

  it("drops two transactions that rest on the same line for their amounts, even when one cites more lines", () => {
    const result = verifyReading(answer([row(), row({ l: [2, 3] })]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 4.5 }], dropped: [{ reason: "line_reused", row: 1 }] });
  });

  it("refuses a statement whose rows all rest on one line", () => {
    const result = failureOf(verifyReading(answer([row(), row({ l: [2, 3] }), row({ l: [2, 3, 4] })]), text));

    expect(result).toMatchObject({ reason: "line_reused", row: 1 });
  });

  it("allows two transactions to cite a shared line when each has its own amount line", () => {
    const shared = statement("2026-10-02", "Corner Cafe 4.50", "Fresh Market 6.00");

    const result = verifyReading(
      answer([
        row({ l: [2, 3], a: "4.50" }),
        row({ l: [2, 3, 4], a: "6.00", m: "Fresh Market" }),
      ]),
      shared,
    );

    expect(result.ok).toBe(true);
  });

  it("does not let a row that was dropped take its line from the next one", () => {
    const result = verifyReading(
      answer([row({ d: "2026-10-09" }), row({ l: [2, 3], a: "4.50" }), row({ l: [3], d: "2026-10-03", a: "6.00" }), row({ l: [4], d: "2026-10-04", a: "7.00" })]),
      text,
    );

    expect(okOf(result).rows.map((kept) => kept.amount)).toEqual([4.5, 6, 7]);
    expect(result).toMatchObject({ dropped: [{ reason: "date_not_found", row: 0 }] });
  });
});

describe("verifyReading: the merchant", () => {
  const text = statement("2026-10-02,POS 4411 LIDL CLUJ RO,-45.20");

  it("drops a name with no word in it", () => {
    expect(failureOf(verifyReading(answer([row({ a: "45.20", m: " - " })]), text)).reason).toBe("merchant_empty");
    expect(failureOf(verifyReading(answer([row({ a: "45.20", m: "" })]), text)).reason).toBe("merchant_empty");
  });

  it("trims and collapses the name", () => {
    const result = verifyReading(answer([row({ a: "45.20", m: "  Lidl   Cluj " })]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ description: "Lidl Cluj" }] });
  });
});

// ---------------------------------------------------------------------------------------------
// Rows that fail are dropped, and the statement fails when too many do
// ---------------------------------------------------------------------------------------------

describe("verifyReading: dropped rows", () => {
  const text = statement(
    "2026-10-02,Corner Cafe,-4.50",
    "2026-10-03,Fresh Market,-6.00",
    "2026-10-04,Pharmacy Green,-7.00",
    "2026-10-05,Book Shop,-8.00",
  );
  const good = [
    row(),
    row({ l: [3], d: "2026-10-03", a: "6.00", m: "Fresh Market" }),
    row({ l: [4], d: "2026-10-04", a: "7.00", m: "Pharmacy Green" }),
    row({ l: [5], d: "2026-10-05", a: "8.00", m: "Book Shop" }),
  ];

  it("leaves out a hallucinated row, keeps the others, and warns without quoting the text", () => {
    const hallucinated = row({ l: [5], d: "2026-10-05", a: "80.00", m: "Book Shop" });

    const result = verifyReading(answer([...good.slice(0, 3), hallucinated]), text);

    expect(result).toMatchObject({
      ok: true,
      rows: [{ amount: 4.5 }, { amount: 6 }, { amount: 7 }],
      dropped: [{ reason: "amount_not_found", row: 3 }],
      warnings: ["1 row the AI read couldn't be matched to the statement and was left out.", "1 line with an amount wasn't read as a transaction."],
    });
    expect(JSON.stringify(okOf(result).warnings)).not.toMatch(/Book|80/);
  });

  it("names every dropped row by position and reason, in the order of the answer", () => {
    const result = verifyReading(
      answer([
        { ...good[0], a: "9.99" },
        good[1],
        good[2],
        good[3],
        { ...good[0], d: "2026-12-02" },
        { ...good[3], l: [99] },
        good[0],
      ]),
      text,
    );

    expect(result).toMatchObject({
      ok: true,
      dropped: [{ reason: "amount_not_found", row: 0 }, { reason: "date_not_found", row: 4 }, { reason: "bad_lines", row: 5 }],
      warnings: ["3 rows the AI read couldn't be matched to the statement and were left out."],
    });
    expect(okOf(result).rows.map((kept) => kept.amount)).toEqual([6, 7, 8, 4.5]);
  });

  it("accepts exactly half dropped, and refuses more than half", () => {
    const wrong = (index: number) => ({ ...good[index], a: "0.99" });

    expect(verifyReading(answer([good[0], good[1], wrong(2), wrong(3)]), text)).toMatchObject({ ok: true, rows: [{}, {}], dropped: [{}, {}] });
    expect(failureOf(verifyReading(answer([good[0], wrong(1), wrong(2), wrong(3)]), text))).toMatchObject({ reason: "amount_not_found", row: 1 });
  });

  it("refuses a reading none of whose rows survive, with the first reason and row", () => {
    const result = failureOf(verifyReading(answer([{ ...good[0], d: "2026-10-09" }, { ...good[1], a: "0.99" }]), text));

    expect(result).toMatchObject({ reason: "date_not_found", row: 0 });
  });

  it("does not count a row skipped for a zero amount as dropped", () => {
    const zero = statement("2026-10-02,Corner Cafe,0.00", "2026-10-03,Fresh Market,-6.00");

    const result = verifyReading(answer([row({ a: "0.00" }), row({ l: [3], d: "2026-10-03", a: "6.00", m: "Fresh Market" })]), zero);

    expect(result).toMatchObject({ ok: true, dropped: [], warnings: ["1 row with a zero amount skipped."] });
  });

  it("still refuses a statement that names no currency, whichever row it is", () => {
    const withoutCurrency = answer(good, { s: { c: null, t: null, l: null } });

    expect(failureOf(verifyReading(withoutCurrency, text))).toMatchObject({ reason: "no_currency", row: 0 });
  });
});

describe("verifyReading: the printed total", () => {
  const text = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Fresh Market,-6.00", "Total payments,10.50");
  const rows = [row(), row({ l: [3], d: "2026-10-03", a: "6.00", m: "Fresh Market" })];

  it("is no warning when the debits add up to it", () => {
    expect(verifyReading(answer(rows, { s: { c: "RON", t: "10.50", l: 4 } }), text)).toMatchObject({ ok: true, warnings: [] });
  });

  it("is compared to the cent, in whatever format the statement prints it", () => {
    const grouped = pdf("Moneda: RON", "02.10.2026\tCorner Cafe\t-1.234,56", "03.10.2026\tFresh Market\t-6,00", "Total payments\t1.240,56");
    const reading = answer([row({ l: [2], a: "1234.56" }), row({ l: [3], d: "2026-10-03", a: "6.00", m: "Fresh Market" })], { s: { c: "RON", t: "1240.56", l: 4 } });

    expect(verifyReading(reading, grouped)).toMatchObject({ ok: true, warnings: [] });
  });

  it("warns with the difference when they don't, and still returns the rows", () => {
    const result = verifyReading(answer([rows[0]], { s: { c: "RON", t: "10.50", l: 4 } }), text);

    expect(result).toMatchObject({
      ok: true,
      rows: [expect.objectContaining({ amount: 4.5 })],
      warnings: [
        "The rows read add up to 4.50, but the statement's printed total of money out is 10.50 (a difference of 6.00).",
        "1 line with an amount wasn't read as a transaction.",
      ],
    });
  });

  it("counts only money out", () => {
    const withCredit = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Refund,6.00", "Total payments,4.50");

    const result = verifyReading(
      answer([row(), row({ l: [3], d: "2026-10-03", a: "6.00", t: "c", m: "Refund" })], { s: { c: "RON", t: "4.50", l: 4 } }),
      withCredit,
    );

    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it("is skipped when the model's total isn't on the line it names", () => {
    const result = verifyReading(answer(rows, { s: { c: "RON", t: "99.99", l: 4 } }), text);

    expect(result).toMatchObject({ ok: true, warnings: [] });
    expect(verifyReading(answer(rows, { s: { c: "RON", t: "10.50", l: 2 } }), text)).toMatchObject({ ok: true });
    expect(verifyReading(answer(rows, { s: { c: "RON", t: "10.50", l: 400 } }), text)).toMatchObject({ ok: true, warnings: [] });
    expect(verifyReading(answer(rows, { s: { c: "RON", t: "10,50", l: 4 } }), text)).toMatchObject({ ok: true, warnings: [] });
  });

  it("is a warning, not a refusal, when a dropped row makes the sums differ", () => {
    const result = verifyReading(answer([rows[0], rows[1], { ...rows[1], l: [2] }], { s: { c: "RON", t: "10.50", l: 4 } }), text);

    expect(result).toMatchObject({
      ok: true,
      rows: [{ amount: 4.5 }, { amount: 6 }],
      dropped: [{ reason: "amount_not_found", row: 2 }],
    });
  });
});

describe("verifyReading: lines no row cites", () => {
  const text = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Fresh Market,-6.00", "2026-10-04,Pharmacy,-7.00");

  it("counts the lines with a date and an amount that no row cites", () => {
    const result = verifyReading(answer([row()]), text);

    expect(result).toMatchObject({ ok: true, warnings: ["2 lines with an amount weren't read as transactions."] });
  });

  it("counts a line with a month-name date as one that looks like a transaction", () => {
    const named = pdf("Moneda: RON", "12 Oct 2026\tCORNER CAFE\t-4,50", "13 octombrie 2026\tFRESH MARKET\t-6,00");

    expect(named.transactionLines).toEqual([2, 3]);
    expect(verifyReading(answer([row({ l: [2], d: "2026-10-12" })]), named)).toMatchObject({
      ok: true,
      warnings: ["1 line with an amount wasn't read as a transaction."],
    });
  });
});

describe("verifyReading: the model's categories", () => {
  const text = statement("2026-10-02,CORNER CAFE,-4.50");

  it("attaches the category of the merchant's entry in k, found by case and spacing, with a subtype only for car", () => {
    const result = verifyReading(
      answer([row()], { k: [{ m: "corner  cafe", c: "entertainment", s: "car_fuel" }] }),
      text,
    );

    expect(result).toMatchObject({ ok: true, rows: [{ suggestion: { category: "entertainment", subtype: null } }] });
  });

  it("leaves the suggestion empty when k has no entry for the merchant", () => {
    const result = verifyReading(answer([row()], { k: [] }), text);

    expect(result).toMatchObject({ ok: true, rows: [{ suggestion: null }] });
  });
});

// ---------------------------------------------------------------------------------------------
// Amounts in a CSV are matched field by field
// ---------------------------------------------------------------------------------------------

describe("verifyReading: amounts in a CSV are matched by field", () => {
  const csv = (header: string, ...lines: string[]) => numberStatement({ kind: "csv", text: [header, ...lines].join("\n") });
  const debit = (d: string, a: string, m: string, l = 2) => row({ l: [l], d, a, m });

  describe("a store number before the amount in a comma file", () => {
    const text = csv("Data,Detalii,Debit RON,Credit", "2026-09-03,Plata POS Mega Image 118,118.40,", "2026-09-04,Plata POS Lidl,45.20,");

    it("reads the amount as the field it is", () => {
      const result = verifyReading(answer([debit("2026-09-03", "118.40", "Mega Image")], { s: { c: "RON", t: null, l: null } }), text);

      expect(result).toMatchObject({ ok: true, rows: [{ amount: 118.4, description: "Mega Image" }] });
    });

    it.each([
      ["the two numbers read as one", "118118.40"],
      ["a part of the amount", "18.40"],
      ["the amount with a digit changed", "118.41"],
      ["an amount from another line", "45.20"],
    ])("still does not find %s", (_name, claimed) => {
      expect(failureOf(verifyReading(answer([debit("2026-09-03", claimed, "Mega Image")]), text))).toMatchObject({ reason: "amount_not_found", row: 0 });
    });

    it("keeps the other rows working", () => {
      const result = verifyReading(answer([debit("2026-09-04", "45.20", "Lidl", 3)]), text);

      expect(result).toMatchObject({ ok: true, rows: [{ amount: 45.2 }] });
    });
  });

  describe("a thousands number inside one quoted field", () => {
    const text = csv("Data,Detalii,Suma RON", '2026-09-03,Plata POS Mega Image,"1,118.40"');

    it("is one amount, 1118.40", () => {
      const result = verifyReading(answer([debit("2026-09-03", "1118.40", "Mega Image")]), text);

      expect(result).toMatchObject({ ok: true, rows: [{ amount: 1118.4 }] });
    });

    it.each([
      ["the part after the group", "118.40"],
      ["the part before it", "1.00"],
    ])("still does not find %s", (_name, claimed) => {
      expect(failureOf(verifyReading(answer([debit("2026-09-03", claimed, "Mega Image")]), text)).reason).toBe("amount_not_found");
    });
  });

  it("keeps a comma inside the field when another delimiter separates the fields", () => {
    const text = csv("Data;Detalii;Suma RON", "2026-09-03;Plata POS Mega Image 118,118.40;118,40", "2026-09-04;Plata POS Lidl;1.118,40");

    expect(verifyReading(answer([debit("2026-09-03", "118.40", "Mega Image")]), text).ok).toBe(true);
    expect(verifyReading(answer([debit("2026-09-04", "1118.40", "Lidl", 3)]), text).ok).toBe(true);
    // Not the stretch of the description that only looks like a thousands number.
    expect(failureOf(verifyReading(answer([debit("2026-09-04", "118.40", "Lidl", 3)]), text)).reason).toBe("amount_not_found");
  });

  it("matches a number that is part of a longer text in a field, but only as a whole number", () => {
    const text = csv("Data,Detalii,Suma RON", "2026-09-03,Plata POS Mega Image 118 EUR 45.20,-45.20 RON");

    expect(verifyReading(answer([debit("2026-09-03", "45.20", "Mega Image")]), text).ok).toBe(true);
    expect(failureOf(verifyReading(answer([debit("2026-09-03", "5.20", "Mega Image")]), text)).reason).toBe("amount_not_found");
  });

  it("finds the amount on the last line of a quoted field that runs over several lines", () => {
    const text = csv("Data,Detalii,Suma RON", '2026-09-03,"Plata POS', 'Mega Image 118",-118.40');

    const result = verifyReading(answer([row({ l: [2, 3], d: "2026-09-03", a: "118.40", m: "Mega Image" })]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 118.4 }] });
  });

  it("finds a printed total by field as well, and warns when the rows do not add up to it", () => {
    const text = csv("Data,Detalii,Debit RON", "2026-09-03,Plata POS Mega Image 118,118.40", "Total,Total plati 2,200.00");
    const reading = (printed: string) => answer([debit("2026-09-03", "118.40", "Mega Image")], { s: { c: "RON", t: printed, l: 3 } });

    expect(verifyReading(reading("200.00"), text)).toMatchObject({
      ok: true,
      warnings: ["The rows read add up to 118.40, but the statement's printed total of money out is 200.00 (a difference of 81.60)."],
    });
    // "2,200.00" is two fields in a comma file, so it is not a number of the line and no total is compared.
    expect(verifyReading(reading("2200.00"), text)).toMatchObject({ ok: true, warnings: [] });
  });

  it("does not change how a PDF line is read: the same text is one number there", () => {
    const text = numberStatement({ kind: "pdf", text: "x", pages: [["Moneda: RON", "03.09.2026\tPlata POS Mega Image 118,118.40"]] });

    expect(failureOf(verifyReading(answer([debit("2026-09-03", "118.40", "Mega Image")]), text)).reason).toBe("amount_not_found");
    expect(verifyReading(answer([debit("2026-09-03", "118118.40", "Mega Image")]), text)).toMatchObject({ ok: true, rows: [{ amount: 118118.4 }] });
  });
});
