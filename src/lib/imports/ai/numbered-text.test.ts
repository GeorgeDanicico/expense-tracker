import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { blankDates, fullDatesIn, looksLikeTransaction, numberStatement } from "@/lib/imports/ai/numbered-text";
import { extractPdfText } from "@/lib/imports/pdf-text";
import { buildTextPdf } from "@/test/pdf";

describe("numberStatement", () => {
  it("numbers the non-empty lines of a CSV from 0001 and keeps the blank ones out", () => {
    const statement = numberStatement({
      kind: "csv",
      text: "Date,Description,Amount\r\n2026-10-02,Corner Cafe,-4.50\r\n\r\n   \r\n2026-10-03,Fresh Market,-123.40\r\n",
    });

    expect(statement.text).toBe(
      ["0001\tDate,Description,Amount", "0002\t2026-10-02,Corner Cafe,-4.50", "0003\t2026-10-03,Fresh Market,-123.40"].join("\n"),
    );
    expect(statement.lines).toEqual(["Date,Description,Amount", "2026-10-02,Corner Cafe,-4.50", "2026-10-03,Fresh Market,-123.40"]);
    expect(statement.transactionLines).toEqual([2, 3]);
  });

  it("marks each page of a PDF, keeps its columns as tabs and numbers on across pages", async () => {
    const pages = await extractPdfText(
      buildTextPdf([
        ["Synthetic statement", ["02.10.2026", "Corner Cafe", "-12,50"]],
        [["03.10.2026", "Fresh Market", "-8,00"]],
      ]),
    );

    const statement = numberStatement({ kind: "pdf", text: pages.flat().join("\n"), pages });

    expect(statement.text).toBe(
      [
        "--- page 1 ---",
        "0001\tSynthetic statement",
        "0002\t02.10.2026\tCorner Cafe\t-12,50",
        "--- page 2 ---",
        "0003\t03.10.2026\tFresh Market\t-8,00",
      ].join("\n"),
    );
    expect(statement.transactionLines).toEqual([2, 3]);
  });

  it("masks IBANs and card numbers in every line before the text can be sent", () => {
    const statement = numberStatement({
      kind: "csv",
      text: "Account RO00 FAKE 0000 0000 0000 0001\n2026-10-02,Card 4111111111111111 shop,-4.50\n",
    });

    expect(statement.text).not.toContain("RO00");
    expect(statement.text).not.toContain("4111");
    expect(statement.lines[0]).toBe("Account …0001");
    expect(statement.lines[1]).toBe("2026-10-02,Card …1111 shop,-4.50");
  });

  it("hashes the masked, numbered text", () => {
    const statement = numberStatement({ kind: "csv", text: "a\nb\n" });

    expect(statement.hash).toBe(createHash("sha256").update("0001\ta\n0002\tb").digest("hex"));
    expect(numberStatement({ kind: "csv", text: "a\r\n\r\nb" }).hash).toBe(statement.hash);
    expect(numberStatement({ kind: "csv", text: "a\nc\n" }).hash).not.toBe(statement.hash);
  });

  it("numbers past 9999 without truncating", () => {
    const statement = numberStatement({ kind: "csv", text: Array.from({ length: 10_001 }, (_, index) => `line ${index}`).join("\n") });

    expect(statement.text.endsWith("10001\tline 10000")).toBe(true);
  });
});

describe("looksLikeTransaction", () => {
  it.each([
    "2026-10-02,Corner Cafe,-4.50",
    "02.10.2026\tPOS 4411 LIDL CLUJ RO\t-1.234,56",
    "02/10/2026 Fuel 45,20 RON",
    "2026-10-02;Shop;(12.50)",
    "02.10.2026,45.20",
    "2 Oct 2026\tPOS LIDL CLUJ\t-45,20",
    "12 octombrie 2026\tPlata POS\t-45,20",
    "Oct 12, 2026 Fuel 45.20 RON",
    "12-Oct-2026;Shop;(12.50)",
  ])("is true for %s", (line) => {
    expect(looksLikeTransaction(line)).toBe(true);
  });

  it.each([
    "Date,Description,Amount",
    "Statement period 01.10.2026 - 31.10.2026 Currency RON",
    "Total payments\t357,70",
    "02.10.2026\tCARD PAYMENT",
    "2 Oct 2026\tCARD PAYMENT",
    "Statement period 1 Oct 2026 - 31 Oct 2026",
    "12.10\tCORNER CAFE\t-4,50",
    "Opening balance 1,000.00",
    "",
  ])("is false for %s", (line) => {
    expect(looksLikeTransaction(line)).toBe(false);
  });
});

describe("blankDates", () => {
  it("replaces dates with spaces of the same length and leaves the rest", () => {
    expect(blankDates("a 2026-10-02 b 02.10.2026 c")).toBe("a            b            c");
    expect(blankDates("ref 12.10.20268 end")).toBe("ref 12.10.20268 end");
  });

  it("blanks a date with a month name, and one that doesn't exist, but not a date without a year", () => {
    expect(blankDates("a 12 Oct 2026 b Oct 12, 2026 c")).toBe("a             b              c");
    expect(blankDates("31.02.2026 x")).toBe(`${" ".repeat(11)}x`);
    expect(blankDates("12 Oct 45,20")).toBe("12 Oct 45,20");
    expect(blankDates("12.10 -4,50")).toBe("12.10 -4,50");
  });
});

describe("what the numbering keeps for the checks", () => {
  it("cuts a CSV's lines into fields with the delimiter and quoting the CSV reader uses", () => {
    const statement = numberStatement({
      kind: "csv",
      text: 'Data;Detalii;Suma\n02.10.2026;"POS; MEGA IMAGE 118";"1.118,40"\n03.10.2026;Cafe 118,12;5,00\n',
    });

    expect(statement.csv).toEqual({
      delimiter: ";",
      fields: [["Data", "Detalii", "Suma"], ["02.10.2026", "POS; MEGA IMAGE 118", "1.118,40"], ["03.10.2026", "Cafe 118,12", "5,00"]],
    });
  });

  it("detects a comma and a tab, and ignores a byte order mark", () => {
    expect(numberStatement({ kind: "csv", text: "\uFEFFDate,Details,Amount\n2026-10-02,Cafe 118,118.40\n" }).csv?.delimiter).toBe(",");
    expect(numberStatement({ kind: "csv", text: "Date\tDetails\tAmount\n2026-10-02\tCafe\t4,50\n" }).csv?.delimiter).toBe("\t");
  });

  it("has no fields for a PDF, whose columns are not delimited", () => {
    expect(numberStatement({ kind: "pdf", text: "a", pages: [["02.10.2026\tCafe\t-4,50"]] }).csv).toBeNull();
  });

  it("collects every date with a year from any line, and leaves out one that is no date", () => {
    const statement = numberStatement({
      kind: "csv",
      text: ["Period;01.10.2026 - 31.10.2026", "Issued;2026-11-02", "Bad;31.02.2026", "12.10;Cafe;-4,50"].join("\n"),
    });

    expect(statement.fullDates).toEqual(["2026-10-01", "2026-10-31", "2026-11-02"]);
    expect(fullDatesIn("ref 12.10.20268 and 3/4/2026")).toEqual(["2026-04-03"]);
  });

  it("collects the dates a month name gives, in English and Romanian, and not the ones without a year", () => {
    const statement = numberStatement({
      kind: "pdf",
      text: "x",
      pages: [["Statement period 1 Oct 2026 to 31 octombrie 2026", "Issued Nov 2, 2026", "12 Oct\tCORNER CAFE\t-4,50"]],
    });

    expect(statement.fullDates).toEqual(["2026-10-01", "2026-10-31", "2026-11-02"]);
    expect(fullDatesIn("30 Feb 2026 and 12 oct. 2026")).toEqual(["2026-10-12"]);
  });

  it("sends nothing new to the model: the text and the hash are what they were", () => {
    const text = "Data;Detalii;Suma\n02.10.2026;MEGA 118;118,40\n";
    const statement = numberStatement({ kind: "csv", text });

    expect(statement.text).toBe("0001\tData;Detalii;Suma\n0002\t02.10.2026;MEGA 118;118,40");
    expect(statement.text).not.toContain("delimiter");
    expect(statement.hash).toBe(createHash("sha256").update(statement.text).digest("hex"));
  });
});
