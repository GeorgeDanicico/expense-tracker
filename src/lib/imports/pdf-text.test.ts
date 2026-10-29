import { describe, expect, it, vi } from "vitest";

import { extractPdfText } from "@/lib/imports/pdf-text";
import { IMPORT_MAX_PDF_PAGES, ImportError } from "@/lib/imports/types";
import { buildTextPdf } from "@/test/pdf";

async function refusal(run: () => Promise<unknown>): Promise<ImportError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error("expected the PDF to be refused");
}

describe("extractPdfText", () => {
  it("returns a two-page PDF as two pages of lines, top to bottom", async () => {
    const pdf = buildTextPdf([
      ["Statement September", "Corner Cafe 4.50"],
      ["Page two", "Fresh Market 123.40", "Closing balance"],
    ]);

    expect(await extractPdfText(pdf)).toEqual([
      ["Statement September", "Corner Cafe 4.50"],
      ["Page two", "Fresh Market 123.40", "Closing balance"],
    ]);
  });

  it("keeps the columns of a three-column table apart with tabs, and a plain line whole", async () => {
    const pdf = buildTextPdf([
      [
        "Account statement",
        ["Date", "Description", "Amount"],
        ["2026-09-01", "Corner Cafe", "-4.50"],
        ["2026-09-02", "Fresh Market", "-123.40"],
      ],
    ]);

    expect(await extractPdfText(pdf)).toEqual([
      ["Account statement", "Date\tDescription\tAmount", "2026-09-01\tCorner Cafe\t-4.50", "2026-09-02\tFresh Market\t-123.40"],
    ]);
  });

  it("keeps a row's columns in order when a narrow column sits close to the next", async () => {
    const pdf = buildTextPdf([[["01.09", "Fresh Market", "-12,50"]]], { columnWidth: 90 });

    expect(await extractPdfText(pdf)).toEqual([["01.09\tFresh Market\t-12,50"]]);
  });

  it("reads accented Latin-1 text and brackets in the text", async () => {
    const pdf = buildTextPdf([["Café Müller (Cluj) \\ 5"]]);

    expect(await extractPdfText(pdf)).toEqual([["Café Müller (Cluj) \\ 5"]]);
  });

  it("leaves the caller's bytes untouched", async () => {
    const pdf = buildTextPdf([["Corner Cafe"]]);
    const copy = new Uint8Array(pdf);

    await extractPdfText(pdf);

    expect(pdf).toEqual(copy);
    expect(await extractPdfText(pdf)).toEqual([["Corner Cafe"]]);
  });

  it("accepts a PDF of exactly 30 pages", async () => {
    const pages = Array.from({ length: IMPORT_MAX_PDF_PAGES }, (_, index) => [`Page ${index + 1}`]);

    const text = await extractPdfText(buildTextPdf(pages));

    expect(text).toHaveLength(IMPORT_MAX_PDF_PAGES);
    expect(text.at(-1)).toEqual(["Page 30"]);
  });

  it("refuses a PDF of more than 30 pages", async () => {
    const pages = Array.from({ length: IMPORT_MAX_PDF_PAGES + 1 }, (_, index) => [`Page ${index + 1}`]);

    const error = await refusal(() => extractPdfText(buildTextPdf(pages)));

    expect(error).toMatchObject({ code: "too_many_pages", status: 422, message: "This PDF has more than 30 pages." });
  });

  it("refuses a password-protected PDF", async () => {
    const error = await refusal(() => extractPdfText(buildTextPdf([["Corner Cafe"]], { encrypted: true })));

    expect(error).toMatchObject({ code: "encrypted_pdf", status: 422, message: "This PDF is password protected." });
  });

  it("refuses a PDF made of an image, which has no text layer", async () => {
    const error = await refusal(() => extractPdfText(buildTextPdf([[], []], { imageOnly: true })));

    expect(error).toMatchObject({
      code: "no_text",
      status: 422,
      message: "This PDF is a scan; scanned statements aren't supported.",
    });
  });

  it("refuses a PDF whose pages are blank", async () => {
    const error = await refusal(() => extractPdfText(buildTextPdf([[" ", ""]])));

    expect(error.code).toBe("no_text");
  });

  it("refuses a truncated file without quoting it", async () => {
    const pdf = buildTextPdf([["ZZSECRETMERCHANTZZ 4.50"]]);

    const error = await refusal(() => extractPdfText(pdf.subarray(0, Math.floor(pdf.length / 2))));

    expect(error).toMatchObject({ code: "unreadable_statement", status: 422 });
    expect(error.message).not.toContain("ZZSECRETMERCHANTZZ");
  });

  it("refuses bytes that only start like a PDF", async () => {
    const error = await refusal(() => extractPdfText(new TextEncoder().encode("%PDF-1.7\nnot really a document\n")));

    expect(error.code).toBe("unreadable_statement");
  });

  it("logs nothing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    await extractPdfText(buildTextPdf([["Corner Cafe"]]));
    await refusal(() => extractPdfText(new TextEncoder().encode("%PDF-1.7\nbroken")));

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
