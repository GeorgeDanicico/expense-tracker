import { describe, expect, it } from "vitest";

import { getBucharestToday } from "@/lib/calendar";
import { numberStatement } from "@/lib/imports/ai/numbered-text";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import { verifyReading } from "@/lib/imports/ai/verify";

/** A synthetic statement as a CSV, so line numbers are easy to count: line 1 is the header. */
function statement(...lines: string[]) {
  return numberStatement({ kind: "csv", text: ["Date,Details,Amount (RON)", ...lines].join("\n") });
}

type Row = ReaderAnswer["r"][number];

const row = (overrides: Partial<Row> = {}): Row => ({ l: [2], d: "2026-10-02", a: "-4.50", c: null, t: "d", m: "Corner Cafe", ...overrides });

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

describe("verifyReading: what is accepted", () => {
  it("returns typed rows: the date and amount are parsed by code, the merchant is the model's cleaned name", () => {
    const result = verifyReading(answer([row()]), statement("2026-10-02,POS 4411 CORNER CAFE RO,-4.50"));

    expect(result).toEqual({
      ok: true,
      rows: [{ expenseDate: "2026-10-02", description: "Corner Cafe", amount: 4.5, currency: "RON", direction: "debit", suggestion: { category: "other", subtype: null } }],
      currency: "RON",
      warnings: [],
    });
  });

  it("reads a decimal comma and thousands groups, once for every amount", () => {
    const text = statement("02.10.2026;CORNER CAFE;-1.234,56", "03.10.2026;SALARY;2.500,00");
    const result = verifyReading(
      answer([
        row({ d: "02.10.2026", a: "-1.234,56" }),
        row({ l: [3], d: "03.10.2026", a: "2.500,00", t: "c", m: "Salary" }),
      ]),
      text,
    );

    expect(result).toMatchObject({ ok: true, rows: [{ amount: 1234.56, direction: "debit" }, { amount: 2500, direction: "credit" }] });
  });

  it("accepts a transaction on up to three consecutive lines, citing words from any of them", () => {
    const text = statement("2026-10-02,CARD PAYMENT,-9.00", "PHARMACY", "GREEN CLUJ");

    const result = verifyReading(answer([row({ l: [2, 3, 4], a: "-9.00", m: "Pharmacy Green Cluj" })]), text);

    expect(result.ok).toBe(true);
  });

  it("folds case and accents when it looks for the merchant's words, and ignores noise the model dropped", () => {
    const result = verifyReading(answer([row({ m: "Cafenea Ștefan" })]), statement("2026-10-02,CAFENEA STEFAN 0042 TERMINAL,-4.50"));

    expect(result.ok).toBe(true);
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
    const result = verifyReading(answer([row({ c: "EUR", a: "4.50" })]), statement("2026-10-02,Corner Cafe,€4.50"));

    expect(result).toMatchObject({ ok: true, rows: [{ currency: "EUR" }] });
  });

  it("finds nothing wrong with a statement that has no transactions", () => {
    expect(verifyReading(answer([]), statement("Opening balance"))).toEqual({ ok: true, rows: [], currency: null, warnings: [] });
  });
});

describe("verifyReading: every number is found whole", () => {
  it.each([
    ["an amount inside a longer one", "-45.20", "2026-10-02,Corner Cafe,-145.20"],
    ["an amount from the middle of a grouped one", "-234.56", '2026-10-02,Corner Cafe,"-1,234.56"'],
    ["an amount missing a decimal", "-45.2", "2026-10-02,Corner Cafe,-45.20"],
    ["an amount that is only a part of a date", "-12.10", "12.10.2026,Corner Cafe,-4.50"],
    ["an amount that is not there", "-4.51", "2026-10-02,Corner Cafe,-4.50"],
  ])("refuses %s", (_name, amount, line) => {
    const text = statement(line);
    const date = line.slice(0, line.indexOf(","));

    const result = failureOf(verifyReading(answer([row({ d: date, a: amount })]), text));

    expect(result).toMatchObject({ reason: "amount_not_found", row: 0 });
  });

  it("accepts a number that sits between other fields of a CSV line", () => {
    const text = statement("2026-10-02,Corner Cafe,-4.50,1234.56");

    expect(verifyReading(answer([row({ a: "-4.50" })]), text).ok).toBe(true);
    expect(verifyReading(answer([row({ a: "1234.56" })]), text).ok).toBe(true);
  });

  it("refuses a date a day off or inside a longer one, and one that reads as no date", () => {
    const text = statement("2026-10-02,Corner Cafe,-4.50");

    expect(failureOf(verifyReading(answer([row({ d: "2026-10-03" })]), text)).reason).toBe("date_not_found");
    expect(failureOf(verifyReading(answer([row({ d: "2026-10-0" })]), text)).reason).toBe("date_not_found");
    expect(failureOf(verifyReading(answer([row({ d: "2026-10-02,Corner" })]), text)).reason).toBe("date_unreadable");
  });

  it("refuses a date that is on the line but is not one code can read", () => {
    const text = statement("2026-13-45,Corner Cafe,-4.50", "2 Foo,Corner Cafe,-4.50");

    expect(failureOf(verifyReading(answer([row({ d: "2026-13-45" })]), text)).reason).toBe("date_unreadable");
    expect(failureOf(verifyReading(answer([row({ l: [3], d: "2 Foo" })]), text)).reason).toBe("date_unreadable");
  });
});

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
  ])("refuses %s", (_name, lines) => {
    expect(failureOf(verifyReading(answer([row({ l: lines })]), text)).reason).toBe("bad_lines");
  });

  it("refuses two transactions that rest on the same line for their amounts, even when one cites more lines", () => {
    const result = failureOf(verifyReading(answer([row(), row({ l: [2, 3] })]), text));

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

  it("refuses a model that found nothing in a statement full of transactions", () => {
    expect(failureOf(verifyReading(answer([]), text)).reason).toBe("no_rows");
  });
});

describe("verifyReading: the merchant", () => {
  const text = statement("2026-10-02,POS 4411 LIDL CLUJ RO,-45.20");

  it("refuses a word that isn't on the cited lines, even when it is on another line", () => {
    const two = statement("2026-10-02,POS 4411 LIDL CLUJ RO,-45.20", "2026-10-03,KAUFLAND,-10.00");

    expect(failureOf(verifyReading(answer([row({ a: "-45.20", m: "Lidl Kaufland" })]), two))).toMatchObject({ reason: "merchant_not_found", row: 0 });
  });

  it("refuses an invented shop", () => {
    expect(failureOf(verifyReading(answer([row({ a: "-45.20", m: "Lidl Cluj Napoca" })]), text)).reason).toBe("merchant_not_found");
  });

  it("refuses a name with no words in it", () => {
    expect(failureOf(verifyReading(answer([row({ a: "-45.20", m: " - " })]), text)).reason).toBe("merchant_empty");
  });
});

describe("verifyReading: amounts that can't be read without guessing", () => {
  it("refuses a column where nothing settles the decimal mark", () => {
    const text = statement("2026-10-02,Corner Cafe,-1.234");

    expect(failureOf(verifyReading(answer([row({ a: "-1.234" })]), text)).reason).toBe("ambiguous_amounts");
  });

  it("refuses an amount code can't read", () => {
    const text = statement("2026-10-02,Corner Cafe,-4.5x0");

    expect(failureOf(verifyReading(answer([row({ a: "-4.5x0" })]), text)).reason).toBe("amount_not_found");
  });
});

describe("verifyReading: the printed total", () => {
  const text = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Fresh Market,-6.00", "Total payments,10.50");
  const rows = [row(), row({ l: [3], d: "2026-10-03", a: "-6.00", m: "Fresh Market" })];

  it("is no warning when the debits add up to it", () => {
    expect(verifyReading(answer(rows, { s: { c: "RON", t: "10.50", l: 4 } }), text)).toMatchObject({ ok: true, warnings: [] });
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
  });
});

describe("verifyReading: lines no row cites", () => {
  const text = statement("2026-10-02,Corner Cafe,-4.50", "2026-10-03,Fresh Market,-6.00", "2026-10-04,Pharmacy,-7.00");

  it("counts the lines with a date and an amount that no row cites", () => {
    const result = verifyReading(answer([row()]), text);

    expect(result).toMatchObject({ ok: true, warnings: ["2 lines with an amount weren't read as transactions."] });
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
// Dates printed without a year
// ---------------------------------------------------------------------------------------------

describe("verifyReading: dates printed without a year", () => {
  /** A PDF-like statement: the given lines, one per line, with columns separated by tabs. */
  const pdf = (...lines: string[]) => numberStatement({ kind: "pdf", text: lines.join("\n"), pages: [lines] });
  const October = ["Perioada 01.10.2026 - 31.10.2026", "Moneda: RON", "Data\tDescriere\tSuma"];
  const dated = (d: string, extra: Partial<Row> = {}) => row({ l: [4], d, a: "-4,50", ...extra });

  it.each([
    ["12.10", "12.10\tCORNER CAFE\t-4,50"],
    ["12/10", "12/10\tCORNER CAFE\t-4,50"],
    ["12.10.", "12.10.\tCORNER CAFE\t-4,50"],
    ["12 Oct", "12 Oct\tCORNER CAFE\t-4,50"],
    ["12 oct.", "12 oct.\tCORNER CAFE\t-4,50"],
    ["12 octombrie", "12 octombrie\tCORNER CAFE\t-4,50"],
  ])("reads %j, taking the year from the period the statement prints", (printed, line) => {
    const result = verifyReading(answer([dated(printed)]), pdf(...October, line), { today: "2030-01-01" });

    expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12", amount: 4.5 }] });
  });

  it("warns that the year was worked out, without quoting the statement", () => {
    const result = verifyReading(answer([dated("12.10")]), pdf(...October, "12.10\tCORNER CAFE\t-4,50"));

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

    const result = verifyReading(answer([dated("28.12"), row({ l: [5], d: "02.01", a: "-6,00" })]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-12-28" }, { expenseDate: "2027-01-02" }] });
  });

  it("uses the full dates of other rows when there is no heading", () => {
    const text = pdf("Moneda: RON", "02.10.2026\tSHOP A\t-1,00", "12.10\tCORNER CAFE\t-4,50", "30.10.2026\tSHOP B\t-2,00");

    const result = verifyReading(answer([row({ l: [3], d: "12.10", a: "-4,50" })]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
  });

  describe("with no full date anywhere", () => {
    const text = pdf("Moneda: RON", "12.10\tCORNER CAFE\t-4,50", "31.10\tCORNER CAFE\t-4,50", "29.02\tCORNER CAFE\t-4,50");
    const read = (printed: string, line: number) => verifyReading(answer([row({ l: [line], d: printed, a: "-4,50" })]), text, { today: "2026-10-30" });

    it("takes the most recent occurrence that is not after today", () => {
      expect(read("12.10", 2)).toMatchObject({ ok: true, rows: [{ expenseDate: "2026-10-12" }] });
      expect(read("31.10", 3)).toMatchObject({ ok: true, rows: [{ expenseDate: "2025-10-31" }] });
      expect(read("29.02", 4)).toMatchObject({ ok: true, rows: [{ expenseDate: "2024-02-29" }] });
    });

    it("says so in the warning", () => {
      expect(read("12.10", 2)).toMatchObject({
        warnings: ["1 date is printed without a year; the most recent year that isn't in the future was used. Check it below."],
      });
    });

    it("defaults to today in Europe/Bucharest", () => {
      const result = verifyReading(answer([row({ l: [2], d: "12.10", a: "-4,50" })]), text);

      expect(result.ok && result.rows[0].expenseDate <= getBucharestToday()).toBe(true);
    });
  });

  describe("refuses", () => {
    it.each([
      ["a day that does not exist", "31.11"],
      ["a 30 February", "30.02"],
      ["a month-first date, which a day-first reader cannot read", "10/25"],
      ["a month that is no month", "12.13"],
      ["a name that is no month", "12 Foo"],
    ])("%s", (_name, printed) => {
      const text = pdf(...October, `${printed}\tCORNER CAFE\t-4,50`);

      expect(failureOf(verifyReading(answer([dated(printed)]), text))).toMatchObject({ reason: "date_unreadable", row: 0 });
    });

    it("a date that is not written on the cited lines, or only as part of something longer", () => {
      const text = pdf(...October, "12.10\tCORNER CAFE\t-4,50", "112.10\tCORNER CAFE\t-4,50", "12 octombrie\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("13.10")]), text)).reason).toBe("date_not_found");
      expect(failureOf(verifyReading(answer([dated("12.10", { l: [5] })]), text)).reason).toBe("date_not_found");
      expect(failureOf(verifyReading(answer([dated("12 oct", { l: [6] })]), text)).reason).toBe("date_not_found");
    });

    it("a date copied without the year that the statement prints right after it", () => {
      const text = pdf(...October, "12.10.2026\tCORNER CAFE\t-4,50", "13 oct. 2026\tCORNER CAFE\t-4,50", "14.10 2026\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("12.10")]), text)).reason).toBe("date_not_found");
      expect(failureOf(verifyReading(answer([dated("13 oct.", { l: [5] })]), text)).reason).toBe("date_not_found");
      expect(failureOf(verifyReading(answer([dated("14.10", { l: [6] })]), text)).reason).toBe("date_not_found");
    });

    it("a date that is really the row's amount", () => {
      const text = pdf(...October, "CORNER CAFE\t12.10", "12.10\tCORNER CAFE\t12.10");

      expect(failureOf(verifyReading(answer([dated("12.10", { a: "12.10" })]), text)).reason).toBe("date_not_found");
      expect(verifyReading(answer([dated("12.10", { a: "12.10", l: [5] })]), text).ok).toBe(true);
    });

    it("a date whose year cannot be told: a period of more than a year with the date inside it twice", () => {
      const text = pdf("Perioada 01.01.2025 - 31.12.2026", "Moneda: RON", "Data\tDescriere\tSuma", "12.10\tCORNER CAFE\t-4,50");

      expect(failureOf(verifyReading(answer([dated("12.10")]), text)).reason).toBe("date_unreadable");
    });
  });

  it("leaves full dates exactly as they were read", () => {
    const text = pdf(...October, "12.10.2025\tCORNER CAFE\t-4,50");

    const result = verifyReading(answer([dated("12.10.2025")]), text);

    expect(result).toMatchObject({ ok: true, rows: [{ expenseDate: "2025-10-12" }], warnings: [] });
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
      ["the two numbers read as one", "118,118.40"],
      ["a part of the amount", "18.40"],
      ["the amount with a digit changed", "118.41"],
      ["the amount with its cents dropped", "118.4"],
      ["an amount from another line", "45.20"],
    ])("still refuses %s", (_name, claimed) => {
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
      const result = verifyReading(answer([debit("2026-09-03", "1,118.40", "Mega Image")]), text);

      expect(result).toMatchObject({ ok: true, rows: [{ amount: 1118.4 }] });
    });

    it.each([
      ["the part after the group", "118.40"],
      ["the part before it", "1"],
      ["the group dropped", "1118.40"],
    ])("still refuses a model claiming %s", (_name, claimed) => {
      expect(failureOf(verifyReading(answer([debit("2026-09-03", claimed, "Mega Image")]), text)).reason).toBe("amount_not_found");
    });
  });

  it("keeps a comma inside the field when another delimiter separates the fields", () => {
    const text = csv("Data;Detalii;Suma RON", "2026-09-03;Plata POS Mega Image 118,118.40;118,40", "2026-09-04;Plata POS Lidl;1.118,40");

    expect(verifyReading(answer([debit("2026-09-03", "118,40", "Mega Image")]), text).ok).toBe(true);
    expect(verifyReading(answer([debit("2026-09-04", "1.118,40", "Lidl", 3)]), text).ok).toBe(true);
    // Not the stretch of the description that only looks like a thousands number.
    expect(failureOf(verifyReading(answer([debit("2026-09-04", "118,40", "Lidl", 3)]), text)).reason).toBe("amount_not_found");
  });

  it("matches a number that is part of a longer text in a field, but only as a whole number", () => {
    const text = csv("Data,Detalii,Suma RON", "2026-09-03,Plata POS Mega Image 118 EUR 45.20,-45.20 RON");

    expect(verifyReading(answer([debit("2026-09-03", "-45.20 RON", "Mega Image")]), text).ok).toBe(true);
    expect(verifyReading(answer([debit("2026-09-03", "45.20", "Mega Image")]), text).ok).toBe(true);
    expect(failureOf(verifyReading(answer([debit("2026-09-03", "5.20", "Mega Image")]), text)).reason).toBe("amount_not_found");
  });

  it("finds the amount on the last line of a quoted field that runs over several lines", () => {
    const text = csv("Data,Detalii,Suma RON", '2026-09-03,"Plata POS', 'Mega Image 118",-118.40');

    const result = verifyReading(answer([row({ l: [2, 3], d: "2026-09-03", a: "-118.40", m: "Mega Image" })]), text);

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
    expect(verifyReading(reading("2,200.00"), text)).toMatchObject({ ok: true, warnings: [] });
  });

  it("does not change how a PDF line is read: the same text is one number there", () => {
    const text = numberStatement({ kind: "pdf", text: "x", pages: [["Moneda: RON", "03.09.2026\tPlata POS Mega Image 118,118.40"]] });

    expect(failureOf(verifyReading(answer([debit("03.09.2026", "118.40", "Mega Image")]), text)).reason).toBe("amount_not_found");
    expect(verifyReading(answer([debit("03.09.2026", "118,118.40", "Mega Image")]), text)).toMatchObject({ ok: true, rows: [{ amount: 118118.4 }] });
  });
});
