import { describe, expect, it, vi } from "vitest";

import {
  STATEMENT_PARSERS,
  UnrecognisedLayoutError,
  claimingParsers,
  findParser,
  parseStatement,
  type StatementParser,
  type StatementSource,
} from "@/lib/imports/parser";
import { IMPORT_PARSER_ID_MAX_LENGTH, ImportError, type ParsedStatement } from "@/lib/imports/types";

const csv = (text: string): StatementSource => ({ kind: "csv", text });
const pdf = (): StatementSource => ({ kind: "pdf", text: "Date Amount", pages: [["Date Amount"]] });

function fakeParser(id: string, overrides: Partial<StatementParser> = {}): StatementParser {
  return {
    id,
    label: id,
    kinds: ["csv"],
    matches: (source) => source.kind === "csv" && source.text.startsWith(id),
    parse: (): ParsedStatement => ({ parserId: id, rows: [] }),
    ...overrides,
  };
}

describe("the registry", () => {
  it("lists the generic CSV parser last", () => {
    expect(STATEMENT_PARSERS.at(-1)?.id).toBe("generic-csv");
  });

  it("has unique ids that fit import_batches.parser_id", () => {
    const ids = STATEMENT_PARSERS.map((parser) => parser.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThanOrEqual(1);
      expect(id.length).toBeLessThanOrEqual(IMPORT_PARSER_ID_MAX_LENGTH);
    }
  });

  it("parses a statement the generic parser recognises", () => {
    const statement = parseStatement(csv("Date,Description,Amount,Currency\n2026-09-01,Shop,-4.50,RON\n"));
    expect(statement.parserId).toBe("generic-csv");
    expect(statement.rows).toHaveLength(1);
  });
});

describe("parseStatement", () => {
  it("takes the first parser in registry order that matches", () => {
    const specific = fakeParser("bank-a", {
      matches: () => true,
      parse: () => ({ parserId: "bank-a", rows: [] }),
    });
    const generic = fakeParser("generic", { matches: () => true });
    expect(parseStatement(csv("x"), [specific, generic]).parserId).toBe("bank-a");
    expect(parseStatement(csv("x"), [generic, specific]).parserId).toBe("generic");
  });

  it("skips a parser that doesn't read this kind of source", () => {
    const csvOnly = fakeParser("csv-only", { matches: () => true });
    const pdfParser = fakeParser("pdf-one", { kinds: ["pdf"], matches: () => true });
    expect(findParser(pdf(), [csvOnly, pdfParser])?.id).toBe("pdf-one");
    expect(findParser(csv("x"), [pdfParser])).toBeNull();
  });

  it("throws UnrecognisedLayoutError with the 422 message when nothing matches", () => {
    let error: unknown;
    try {
      parseStatement(csv("Account,Balance\nEveryday,10\n"));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnrecognisedLayoutError);
    expect(error).toBeInstanceOf(ImportError);
    const refused = error as UnrecognisedLayoutError;
    expect(refused.code).toBe("unrecognised_layout");
    expect(refused.status).toBe(422);
    expect(refused.message).toBe("This statement's layout isn't supported yet.");
  });

  it("throws UnrecognisedLayoutError for a PDF while no parser reads PDFs", () => {
    expect(() => parseStatement(pdf())).toThrow(UnrecognisedLayoutError);
  });

  it("counts a matches() that throws as no match", () => {
    const broken = fakeParser("broken", {
      matches: () => {
        throw new Error("row text: Secret Merchant");
      },
    });
    expect(() => parseStatement(csv("x"), [broken])).toThrow(UnrecognisedLayoutError);
    expect(findParser(csv("x"), [broken, fakeParser("x")])?.id).toBe("x");
  });

  it("lets a parser's ImportError through unchanged", () => {
    const refusing = fakeParser("refusing", {
      matches: () => true,
      parse: () => {
        throw new ImportError("ambiguous_amounts");
      },
    });
    expect(() => parseStatement(csv("x"), [refusing])).toThrow(
      expect.objectContaining({ code: "ambiguous_amounts" }),
    );
  });

  it("turns any other failure of parse() into unreadable_statement without its text", () => {
    const crashing = fakeParser("crashing", {
      matches: () => true,
      parse: () => {
        throw new TypeError("Cannot read Secret Merchant");
      },
    });
    let error: unknown;
    try {
      parseStatement(csv("x"), [crashing]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe("unreadable_statement");
    expect((error as ImportError).message).not.toContain("Secret");
  });

  it("never logs", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    try {
      expect(() => parseStatement(csv("Account,Balance\nSecret Merchant,10\n"))).toThrow();
      expect(() => parseStatement(csv("Date,Description,Amount\nnot a date,Secret Merchant,1\n"))).toThrow();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("claimingParsers", () => {
  it("lists every parser that matches, in order", () => {
    const parsers = [fakeParser("a"), fakeParser("ab"), fakeParser("c")];
    expect(claimingParsers(csv("abc"), parsers).map((parser) => parser.id)).toEqual(["a", "ab"]);
    expect(claimingParsers(csv("zzz"), parsers)).toEqual([]);
  });
});
