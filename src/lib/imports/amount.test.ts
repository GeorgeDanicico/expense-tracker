import { describe, expect, it } from "vitest";

import { amountToCents, centsToAmount, detectDecimalMark, parseAmount } from "@/lib/imports/amount";

const dot = { decimal: "." } as const;
const comma = { decimal: "," } as const;

describe("parseAmount", () => {
  it.each([
    ["1.234,56", comma, 123_456],
    ["1,234.56", dot, 123_456],
    ["1 234,56", comma, 123_456],
    ["1 234,56", comma, 123_456],
    ["1 234.56", dot, 123_456],
    ["1'234.56", dot, 123_456],
    ["1.234.567,89", comma, 123_456_789],
    ["45,20", comma, 4520],
    ["45.20", dot, 4520],
    ["45", dot, 4500],
    ["45,5", comma, 4550],
    [",50", comma, 50],
    [".5", dot, 50],
    ["0", dot, 0],
    ["1,234", dot, 123_400],
    ["1.234", comma, 123_400],
    ["12.500", dot, 1250],
    ["  45.20  ", dot, 4520],
  ] as const)("reads %j", (text, options, cents) => {
    expect(parseAmount(text, options)).toBe(cents);
  });

  it.each([
    ["-45.20", dot, -4520],
    ["45.20-", dot, -4520],
    ["−45.20", dot, -4520],
    ["- 45,20", comma, -4520],
    ["(45.20)", dot, -4520],
    ["(1.234,56)", comma, -123_456],
    ["+45.20", dot, 4520],
    ["45.20+", dot, 4520],
    ["-0.00", dot, 0],
  ] as const)("reads the sign of %j", (text, options, cents) => {
    expect(parseAmount(text, options)).toBe(cents);
    expect(Object.is(parseAmount(text, options), -0)).toBe(false);
  });

  it.each([
    ["€ 45.20", dot, 4520],
    ["€45.20", dot, 4520],
    ["$45.20", dot, 4520],
    ["45,20 RON", comma, 4520],
    ["RON 45,20", comma, 4520],
    ["45.20RON", dot, 4520],
    ["45,20 lei", comma, 4520],
    ["-45,20 EUR", comma, -4520],
    ["EUR -45.20", dot, -4520],
    ["(45.20 USD)", dot, -4520],
  ] as const)("ignores the currency in %j", (text, options, cents) => {
    expect(parseAmount(text, options)).toBe(cents);
  });

  it("takes a three-letter word beside the number for a currency code", () => {
    expect(parseAmount("12abc", dot)).toBe(1200);
  });

  it("is exact where floats are not", () => {
    expect(parseAmount("0.29", dot)).toBe(29);
    expect(parseAmount("1.15", dot)).toBe(115);
    expect(parseAmount("4.35", dot)).toBe(435);
    expect(parseAmount("9999999999.99", dot)).toBe(999_999_999_999);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12abcd",
    "ab1c",
    "1.2.3",
    "1,2,3",
    "1,23.4,5",
    "12 34",
    "1.2345",
    "--5",
    "-(5)",
    "5 -5",
    ".",
    "-",
    "1e5",
    "9999999999.995",
    "10000000000.00",
    "1.234,567,89",
  ])("refuses %j", (text) => {
    expect(parseAmount(text, dot)).toBeNull();
  });

  it("refuses text whose grouping contradicts the decimal mark", () => {
    expect(parseAmount("1,234.56", comma)).toBeNull();
    expect(parseAmount("1.234,56", dot)).toBeNull();
    expect(parseAmount("12,34.5", dot)).toBeNull();
  });
});

describe("detectDecimalMark", () => {
  it("is settled by a cell with one or two digits after the last separator", () => {
    expect(detectDecimalMark(["45,20", "12,5"])).toBe(",");
    expect(detectDecimalMark(["45.20", "7.5"])).toBe(".");
  });

  it("is settled by a cell holding both marks", () => {
    expect(detectDecimalMark(["1.234,56"])).toBe(",");
    expect(detectDecimalMark(["1,234.56"])).toBe(".");
  });

  it("reads a repeated mark as thousands", () => {
    expect(detectDecimalMark(["1.234.567"])).toBe(",");
    expect(detectDecimalMark(["1,234,567"])).toBe(".");
  });

  it("lets one clear cell settle a column that also has ambiguous ones", () => {
    expect(detectDecimalMark(["1.234", "2.500", "45.20"])).toBe(".");
    expect(detectDecimalMark(["1.234", "45,20"])).toBe(",");
  });

  it("refuses a column where nothing settles the mark", () => {
    expect(detectDecimalMark(["1.234"])).toBeNull();
    expect(detectDecimalMark(["1,234", "2,500", "10"])).toBeNull();
  });

  it("refuses a column whose cells disagree", () => {
    expect(detectDecimalMark(["45,20", "1,234.56"])).toBeNull();
    expect(detectDecimalMark(["45.20", "12,50"])).toBeNull();
  });

  it("needs no mark for whole numbers", () => {
    expect(detectDecimalMark(["100", "250", "-30"])).toBe(".");
    expect(detectDecimalMark([])).toBe(".");
  });

  it("ignores blanks, headers and other text, and reads signs, symbols and parentheses", () => {
    expect(detectDecimalMark(["", "  ", "Amount", "(45,20)", "-12,5 RON"])).toBe(",");
    expect(detectDecimalMark(["€ 1,234.56"])).toBe(".");
  });

  it("agrees with parseAmount for the whole column", () => {
    const cells = ["1.234,56", "45,20", "-7,5", "2.000"];
    const decimal = detectDecimalMark(cells);
    expect(decimal).toBe(",");
    expect(cells.map((cell) => parseAmount(cell, { decimal: decimal! }))).toEqual([123_456, 4520, -750, 200_000]);
  });
});

describe("cents and amounts", () => {
  it("converts in both directions", () => {
    expect(centsToAmount(4520)).toBe(45.2);
    expect(amountToCents(45.2)).toBe(4520);
    expect(amountToCents(centsToAmount(999_999_999_999))).toBe(999_999_999_999);
    expect(amountToCents(1.15)).toBe(115);
    expect(amountToCents(centsToAmount(29))).toBe(29);
  });
});
