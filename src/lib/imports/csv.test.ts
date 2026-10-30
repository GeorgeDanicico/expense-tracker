import { describe, expect, it } from "vitest";

import { detectDelimiter, parseCsv, readCsv, splitCsvLines } from "@/lib/imports/csv";
import { ImportError } from "@/lib/imports/types";

describe("parseCsv", () => {
  it("splits records and fields", () => {
    expect(parseCsv("a,b,c\n1,2,3\n", ",")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("reads CRLF, LF and CR line ends, and a last line without one", () => {
    const expected = [["a", "b"], ["1", "2"], ["3", "4"]];
    expect(parseCsv("a,b\r\n1,2\r\n3,4", ",")).toEqual(expected);
    expect(parseCsv("a,b\n1,2\n3,4\n", ",")).toEqual(expected);
    expect(parseCsv("a,b\r1,2\r3,4\r", ",")).toEqual(expected);
  });

  it("reads quoted fields with delimiters, doubled quotes and line breaks inside", () => {
    const text = '"a,b","say ""hi""","line 1\nline 2","crlf\r\ninside"\n';
    expect(parseCsv(text, ",")).toEqual([["a,b", 'say "hi"', "line 1\nline 2", "crlf\r\ninside"]]);
  });

  it("reads a quoted field that holds the other delimiters", () => {
    expect(parseCsv('"a;b"\t"c,d"', "\t")).toEqual([["a;b", "c,d"]]);
  });

  it("keeps empty fields, including a trailing one", () => {
    expect(parseCsv("a,,c,\n,,\n", ",")).toEqual([["a", "", "c", ""], ["", "", ""]]);
  });

  it("drops empty lines but keeps an empty quoted field", () => {
    expect(parseCsv("a,b\n\n\n1,2\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('""\n', ",")).toEqual([[""]]);
  });

  it("treats a quote that doesn't start a field as an ordinary character", () => {
    expect(parseCsv('5" pipe,say "hi"\n', ",")).toEqual([['5" pipe', 'say "hi"']]);
  });

  it("keeps text after a closing quote as part of the field", () => {
    expect(parseCsv('"abc"def,x\n', ",")).toEqual([["abcdef", "x"]]);
  });

  it("returns nothing for an empty text", () => {
    expect(parseCsv("", ",")).toEqual([]);
    expect(parseCsv("\n\r\n", ",")).toEqual([]);
  });

  it("refuses an unclosed quote without quoting the file", () => {
    let error: unknown;
    try {
      parseCsv('a,b\n"secret merchant,12.00\n', ",");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe("unreadable_statement");
    expect((error as ImportError).message).not.toContain("secret");
  });

  it("stops after maxRecords", () => {
    expect(parseCsv("a\nb\nc\nd\n", ",", { maxRecords: 2 })).toEqual([["a"], ["b"]]);
  });
});

describe("detectDelimiter", () => {
  it("finds a comma, a semicolon and a tab", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
  });

  it("prefers the delimiter that splits every row the same way over decimal commas", () => {
    const text = "Date;Description;Amount\n01.09.2026;Shop;-45,20\n02.09.2026;Cafe;-3,00\n";
    expect(detectDelimiter(text)).toBe(";");
  });

  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('a;b\n"x,y,z";2\n"p,q";3\n')).toBe(";");
  });

  it("copes with lines above the header that have no delimiter", () => {
    expect(detectDelimiter("Statement\n\nDate;Description;Amount\n1;a;2\n3;b;4\n")).toBe(";");
  });

  it("defaults to a comma when nothing splits", () => {
    expect(detectDelimiter("just one column\nanother\n")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });

  it("copes with an unclosed quote", () => {
    expect(() => detectDelimiter('a,b\n"open,2\n')).not.toThrow();
  });
});

describe("readCsv", () => {
  it("detects the delimiter and ignores a leading byte order mark", () => {
    expect(readCsv("﻿Date;Amount\n2026-09-01;4,50\n")).toEqual({
      delimiter: ";",
      records: [["Date", "Amount"], ["2026-09-01", "4,50"]],
    });
  });

  it("can stop early", () => {
    expect(readCsv("a,b\n1,2\n3,4\n", { maxRecords: 1 }).records).toEqual([["a", "b"]]);
  });
});

describe("splitCsvLines", () => {
  it("splits each line into fields with the delimiter it is given", () => {
    expect(splitCsvLines(["a,b,c", "1,,3"], ",")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
    expect(splitCsvLines(["a;b,c"], ";")).toEqual([["a", "b,c"]]);
    expect(splitCsvLines(["a\tb"], "\t")).toEqual([["a", "b"]]);
  });

  it("reads quotes as parseCsv does: a quote opens a field only at its start, \"\" is a quote, the delimiter is plain inside quotes", () => {
    expect(splitCsvLines(['x,"1,118.40",y', 'say "hi",a"b', '"say ""hi""",z'], ",")).toEqual([
      ["x", "1,118.40", "y"],
      ['say "hi"', 'a"b'],
      ['say "hi"', "z"],
    ]);
  });

  it("agrees with parseCsv on every single-line record", () => {
    const text = ['Date,Description,Amount', '2026-10-03,"POS, MEGA IMAGE 118",118.40', '2026-10-04,Plata POS Mega Image 118,118.40', '2026-10-05,"a ""quoted"" shop","1,118.40"', ',,'].join("\n");
    const lines = text.split("\n");

    expect(splitCsvLines(lines, ",")).toEqual(parseCsv(text, ","));
  });

  it("carries a quoted field over line breaks, so its pieces are fields of their own lines", () => {
    expect(splitCsvLines(['2026-10-03,"CARD PAYMENT;', 'MEGA, IMAGE",-118.40', "2026-10-04,Shop,-5.00"], ",")).toEqual([
      ["2026-10-03", "CARD PAYMENT;"],
      ["MEGA, IMAGE", "-118.40"],
      ["2026-10-04", "Shop", "-5.00"],
    ]);
  });

  it("never throws on a quote that is never closed", () => {
    expect(splitCsvLines(['a,"open', "b,c"], ",")).toEqual([["a", "open"], ["b,c"]]);
  });
});
