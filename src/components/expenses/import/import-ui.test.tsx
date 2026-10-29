import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { restImportApi } from "@/components/expenses/import/import-api";
import { addedHeading, ResultView, undoneDescription } from "@/components/expenses/import/result-view";
import { ReviewStep, REOPENED_NOTE, REVIEW_NOTE } from "@/components/expenses/import/review-step";
import { ReviewTable, RULE_NOTE } from "@/components/expenses/import/review-table";
import {
  DISCARD_NOTE,
  EMPTY_STATEMENT_FILE,
  NOT_A_STATEMENT_FILE,
  PDF_COMING_SOON,
  statementContentType,
  statementKind,
  UploadStep,
  uploadErrorMessage,
  validateStatementFile,
} from "@/components/expenses/import/upload-step";
import { ledgerSystem } from "@/components/ui/theme";
import { ApiError } from "@/lib/api/client";
import { importApiUrl, importConfirmApiUrl, importUndoApiUrl, IMPORTS_API_KEY } from "@/lib/api/keys";
import { initialReview } from "@/lib/imports/review";
import type { DraftRow, ImportBatch, ImportDraft } from "@/lib/imports/types";
import { anExpense } from "@/test/builders";

// Component tests render static markup (no DOM), so what happens on a click is tested through the
// pure state in `review.test.ts` and the requests below; this file checks what each part shows.

const noop = () => {};

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

const batch: ImportBatch = {
  id: "b1",
  status: "draft",
  sourceKind: "csv",
  parserId: "generic-csv",
  currency: "EUR",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  rowCount: 4,
  skippedCredits: 4,
  createdAt: "2026-10-29T10:00:00.000Z",
  expiresAt: "2026-10-30T10:00:00.000Z",
  confirmedAt: null,
  confirmedCount: null,
  undoneAt: null,
};

function aRow(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "r1", position: 1, expenseDate: "2026-10-12", description: "Cafe", amount: 4.5, currency: "EUR",
    category: "other", subtype: null, ruleMatched: false, notes: null, duplicateOf: null, importable: true,
    ...overrides,
  };
}

const draft: ImportDraft = {
  batch,
  rows: [
    aRow({ id: "a", description: "Cafe" }),
    aRow({ id: "b", description: "Lidl Cluj", amount: 45.2, duplicateOf: { id: "e1", description: "Lidl", expenseDate: "2026-10-12", amount: 45.2 } }),
    aRow({ id: "c", description: "Foreign shop", amount: 399, currency: "RON", importable: false }),
    aRow({ id: "d", description: "OMV 1642", amount: 300, category: "car", subtype: "car_fuel", ruleMatched: true }),
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("statement files", () => {
  const file = (name: string, size = 100) => ({ name, size });

  it("tells the kind from the extension, whatever its case", () => {
    expect(statementKind(file("Statement.CSV"))).toBe("csv");
    expect(statementKind(file("a.pdf"))).toBe("pdf");
    expect(statementKind(file("a.xlsx"))).toBeNull();
    expect(statementContentType("csv")).toBe("text/csv");
    expect(statementContentType("pdf")).toBe("application/pdf");
  });

  it("accepts a CSV up to 2 MB and refuses everything else before any request", () => {
    expect(validateStatementFile(file("a.csv", 2 * 1024 * 1024))).toBeNull();
    expect(validateStatementFile(file("a.csv", 2 * 1024 * 1024 + 1))).toBe("Choose a statement under 2 MB.");
    expect(validateStatementFile(file("a.csv", 0))).toBe(EMPTY_STATEMENT_FILE);
    expect(validateStatementFile(file("a.xlsx"))).toBe(NOT_A_STATEMENT_FILE);
    expect(validateStatementFile(file("a.pdf"))).toBe(PDF_COMING_SOON);
  });

  it("shows the server's own message for a refused upload", () => {
    for (const [status, message] of [
      [413, "Choose a statement under 2 MB."],
      [415, "That file isn't a CSV statement."],
      [422, "This statement's layout isn't supported yet."],
      [409, "You imported this statement on 3 October. Undo that import to import it again."],
      [429, "Too many uploads. Try again later."],
    ] as const) {
      expect(uploadErrorMessage(new ApiError(message, status))).toBe(message);
    }
  });

  it("falls back to a plain message for a status that arrives without one", () => {
    const empty = "Something went wrong. Please try again.";
    expect(uploadErrorMessage(new ApiError(empty, 413))).toBe("Choose a statement under 2 MB.");
    expect(uploadErrorMessage(new ApiError(empty, 415))).toBe(NOT_A_STATEMENT_FILE);
    expect(uploadErrorMessage(new ApiError(empty, 429))).toBe("Too many uploads. Try again later.");
    expect(uploadErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("restImportApi", () => {
  function stubFetch(response: Response) {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("uploads the file itself as the body, with its own Content-Type and never multipart", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ batch, reopened: false, warnings: [] }), { status: 201 }));
    const csv = new File(["Date,Description,Amount\n"], "statement.csv", { type: "" });
    await restImportApi.upload(csv, "text/csv");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(IMPORTS_API_KEY);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(csv);
    expect(init?.headers).toMatchObject({ "Content-Type": "text/csv" });
  });

  it("confirms with the ticked rows as JSON", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ batch, created: [] })));
    const rows = [{ id: "a", description: "Cafe", amount: 4.5, expenseDate: "2026-10-12", category: "other" as const, subtype: null, notes: null }];
    await restImportApi.confirm("b1", rows);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(importConfirmApiUrl("b1"));
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ rows });
  });

  it("reads a draft, discards it and undoes an import", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ batch, rows: [] })));
    await restImportApi.getDraft("b1");
    expect(fetchMock.mock.calls[0][0]).toBe(importApiUrl("b1"));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await restImportApi.discard("b1");
    expect(fetchMock.mock.calls[1][0]).toBe(importApiUrl("b1"));
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ batch, removed: 3 })));
    await expect(restImportApi.undo("b1")).resolves.toMatchObject({ removed: 3 });
    expect(fetchMock.mock.calls[2][0]).toBe(importUndoApiUrl("b1"));
    expect(fetchMock.mock.calls[2][1]?.method).toBe("POST");
  });

  it("carries a confirm's field errors on the ApiError", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Check the rows and try again.", fieldErrors: { "rows.1.amount": ["Too small."] } }), { status: 422 }));
    const caught = await restImportApi.confirm("b1", []).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).fieldErrors).toEqual({ "rows.1.amount": ["Too small."] });
  });
});

describe("UploadStep", () => {
  it("offers a picker for a CSV, names PDFs as coming soon and says the file is discarded", () => {
    const html = render(<UploadStep onFile={noop} pending={false} />);
    expect(html).toContain("Drop a statement here");
    expect(html).toContain("Choose a file");
    expect(html).toContain("PDF statements are coming soon.");
    expect(html).toContain(DISCARD_NOTE);
    expect(DISCARD_NOTE).toBe("The file is read and discarded. Only the rows below are kept, for 24 hours.");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.csv"/);
  });

  it("shows why the last upload was refused, and a notice", () => {
    const html = render(<UploadStep onFile={noop} pending={false} error="This statement's layout isn't supported yet." notice="The import was discarded." />);
    expect(html).toContain("This statement&#x27;s layout isn&#x27;t supported yet.");
    expect(html).toContain("The import was discarded.");
  });
});

describe("ReviewTable", () => {
  const items = initialReview(draft.rows);
  const html = render(<ReviewTable items={items} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);

  it("has a column for the tick, date, description, amount, currency and category", () => {
    for (const header of ["Date", "Description", "Amount", "Currency", "Category"]) expect(html).toContain(`>${header}</th>`);
  });

  it("ticks ordinary rows and leaves a duplicate and a foreign row unticked", () => {
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*aria-label="Add ([^"]+)"[^>]*>/g)];
    expect(boxes.map((box) => [box[1], box[0].includes("checked=\"\""), box[0].includes("disabled")])).toEqual([
      ["Cafe", true, false],
      ["Lidl Cluj", false, false],
      ["Foreign shop", false, true],
      ["OMV 1642", true, false],
    ]);
  });

  it("shows what a possible duplicate looks like", () => {
    expect(html).toContain("Possible duplicate");
    expect(html).toMatch(/Looks like [\s\S]*?<em[^>]*>Lidl, 12 Oct, 45\.20<\/em>/);
  });

  it("explains and disables a row in another currency", () => {
    expect(html).toContain("In RON. Your account is in EUR, so this can&#x27;t be imported.");
    expect(html).toMatch(/<input[^>]*aria-label="Description of Foreign shop"[^>]*disabled/);
    expect(html).toMatch(/<select[^>]*aria-label="Category for Foreign shop"[^>]*>/);
  });

  it("shows a merchant-rule row's car category as fixed, without selects", () => {
    expect(html).toContain(RULE_NOTE);
    expect(html).toContain("Car / Car Fuel");
    expect(html).not.toContain('aria-label="Category for OMV 1642"');
    expect(html).toContain('aria-label="Category for Cafe"');
  });

  it("offers the subtype select only for a category that has subtypes", () => {
    const car = initialReview([aRow({ id: "x", description: "Garage", category: "car" })]);
    const withCar = render(<ReviewTable items={car} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);
    expect(withCar).toContain('aria-label="Subtype for Garage"');
    expect(html).not.toContain('aria-label="Subtype for Cafe"');
  });

  it("shows a server message under its row, and a blank description on a ticked row", () => {
    const blank = initialReview([aRow({ id: "x", description: "" })]);
    const shown = render(<ReviewTable items={items} accountCurrency="EUR" rowErrors={{ a: "Amount must be greater than zero." }} dispatch={noop} />);
    expect(shown).toContain("Amount must be greater than zero.");
    expect(render(<ReviewTable items={blank} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />)).toContain("Enter a description.");
  });
});

describe("ReviewStep", () => {
  const props = { draft, accountCurrency: "EUR", onConfirmed: noop, onDiscarded: noop, onStartOver: noop };

  it("summarises the statement: parser, period, rows, duplicates, other currencies and skipped credits", () => {
    const html = render(<ReviewStep {...props} />);
    expect(html).toContain("Generic CSV · 1 Oct to 31 Oct 2026");
    expect(html).toContain("4 rows, 1 possible duplicate, 1 in another currency, 4 incoming payments skipped");
    expect(html).toContain(REVIEW_NOTE);
  });

  it("offers the three selections", () => {
    const html = render(<ReviewStep {...props} />);
    for (const label of ["Select all", "Select none", "All except duplicates"]) expect(html).toContain(label);
  });

  it("puts the count, the total and the Add and Discard buttons in the footer", () => {
    const html = render(<ReviewStep {...props} />);
    expect(html).toContain("2 of 4 rows selected");
    expect(html).toContain("€304.50");
    expect(html).toContain("Add 2 expenses");
    expect(html).toContain(">Discard</button>");
  });

  it("says so when the upload matched a draft that already existed", () => {
    expect(render(<ReviewStep {...props} reopened />)).toContain(REOPENED_NOTE);
    expect(render(<ReviewStep {...props} />)).not.toContain(REOPENED_NOTE);
  });

  it("shows the parser's warnings", () => {
    expect(render(<ReviewStep {...props} warnings={["1 description was too long to keep whole; the end was cut."]} />))
      .toContain("1 description was too long");
  });

  it("disables Add while nothing is ticked", () => {
    const none = { ...draft, rows: draft.rows.map((row) => ({ ...row, importable: false })) };
    expect(render(<ReviewStep {...props} draft={none} />)).toMatch(/<button[^>]*disabled[^>]*>Add expenses<\/button>/);
  });
});

describe("ResultView", () => {
  const created = [
    anExpense({ id: "e1", amount: 4.5, expenseDate: "2026-10-12" }),
    anExpense({ id: "e2", amount: 300, expenseDate: "2026-09-30" }),
  ];
  const result = { batch: { ...batch, status: "confirmed" as const }, created };

  it("says how many expenses were added, with the total and a link to each month", () => {
    const html = render(<ResultView result={result} accountCurrency="EUR" onUploadAnother={noop} />);
    expect(html).toContain("Added 2 expenses");
    expect(html).toContain("€304.50");
    expect(html).toContain('href="/expenses?month=2026-10"');
    expect(html).toContain("View October 2026");
    expect(html).toContain('href="/expenses?month=2026-09"');
  });

  it("has an Undo button and a way to import another statement", () => {
    const html = render(<ResultView result={result} accountCurrency="EUR" onUploadAnother={noop} />);
    expect(html).toContain("Undo");
    expect(html).toContain("Import another statement");
  });

  it("words the heading and the undone state", () => {
    expect(addedHeading(1)).toBe("Added 1 expense");
    expect(addedHeading(34)).toBe("Added 34 expenses");
    expect(undoneDescription(34)).toBe("34 expenses removed. Your expenses are as they were before the import.");
  });
});
