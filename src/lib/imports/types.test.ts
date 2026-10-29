import { describe, expect, it } from "vitest";

import {
  IMPORT_CONTENT_HASH_PATTERN,
  IMPORT_CURRENCY_PATTERN,
  IMPORT_ERROR_CODES,
  IMPORT_ERROR_MESSAGES,
  IMPORT_ERROR_STATUS,
  ImportError,
  ImportLimits,
  tooLargeMessage,
} from "@/lib/imports/types";

describe("import limits", () => {
  it("are the plan's", () => {
    expect(ImportLimits).toEqual({
      csvMaxBytes: 2_097_152,
      pdfMaxBytes: 5_242_880,
      maxRows: 500,
      maxPdfPages: 30,
      draftHours: 24,
    });
  });

  it("repeat the database's formats", () => {
    expect(IMPORT_CURRENCY_PATTERN.test("RON")).toBe(true);
    expect(IMPORT_CURRENCY_PATTERN.test("ron")).toBe(false);
    expect(IMPORT_CONTENT_HASH_PATTERN.test("a".repeat(64))).toBe(true);
    expect(IMPORT_CONTENT_HASH_PATTERN.test("A".repeat(64))).toBe(false);
    expect(IMPORT_CONTENT_HASH_PATTERN.test("a".repeat(63))).toBe(false);
  });
});

describe("import errors", () => {
  it("have a status and a message for every code", () => {
    for (const code of IMPORT_ERROR_CODES) {
      expect(IMPORT_ERROR_STATUS[code]).toBeGreaterThanOrEqual(409);
      expect(IMPORT_ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it("carry the code, its status and its default message", () => {
    const error = new ImportError("unrecognised_layout");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("unrecognised_layout");
    expect(error.status).toBe(422);
    expect(error.message).toBe("This statement's layout isn't supported yet.");
    expect(new ImportError("too_many_rows").message).toContain("500");
    expect(new ImportError("too_many_pages").message).toContain("30");
  });

  it("map the refusals to their HTTP statuses", () => {
    expect(new ImportError("unsupported_type").status).toBe(415);
    expect(new ImportError("encrypted_pdf").status).toBe(422);
    expect(new ImportError("no_text").status).toBe(422);
    expect(new ImportError("file_too_large").status).toBe(413);
    expect(new ImportError("already_imported").status).toBe(409);
    expect(new ImportError("rate_limited").status).toBe(429);
    expect(new ImportError("no_debits").status).toBe(422);
  });

  it("accept a message of their own", () => {
    expect(new ImportError("already_imported", "You imported this statement on 3 October.").message)
      .toBe("You imported this statement on 3 October.");
  });

  it("say how big a file may be", () => {
    expect(tooLargeMessage("csv")).toBe("Choose a statement under 2 MB.");
    expect(tooLargeMessage("pdf")).toBe("Choose a statement under 5 MB.");
  });
});
