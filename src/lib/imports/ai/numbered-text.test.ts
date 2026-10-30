import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { blankDates, looksLikeTransaction, numberStatement } from "@/lib/imports/ai/numbered-text";
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
  ])("is true for %s", (line) => {
    expect(looksLikeTransaction(line)).toBe(true);
  });

  it.each([
    "Date,Description,Amount",
    "Statement period 01.10.2026 - 31.10.2026 Currency RON",
    "Total payments\t357,70",
    "02.10.2026\tCARD PAYMENT",
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
});
