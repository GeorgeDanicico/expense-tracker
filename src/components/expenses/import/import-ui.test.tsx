import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SWRConfig } from "swr";

import { restImportApi } from "@/components/expenses/import/import-api";
import { RecentImports, RecentImportsList } from "@/components/expenses/import/recent-imports";
import { ReviewCards } from "@/components/expenses/import/review-cards";
import { addedHeading, ResultView, undoneDescription } from "@/components/expenses/import/result-view";
import { undoDescription } from "@/components/expenses/import/undo-dialog";
import { ReviewStep, REOPENED_NOTE, REVIEW_NOTE } from "@/components/expenses/import/review-step";
import { ReviewTable } from "@/components/expenses/import/review-table";
import {
  AiReadingHint,
  DISCARD_NOTE,
  EMPTY_STATEMENT_FILE,
  NOT_A_STATEMENT_FILE,
  statementContentType,
  statementKind,
  UploadStep,
  uploadErrorCode,
  uploadErrorMessage,
  validateStatementFile,
} from "@/components/expenses/import/upload-step";
import { ledgerSystem } from "@/components/ui/theme";
import { ApiError } from "@/lib/api/client";
import { importApiUrl, importConfirmApiUrl, importUndoApiUrl, IMPORTS_API_KEY } from "@/lib/api/keys";
import type { ImportsResponse } from "@/lib/api/keys";
import type { RecentImport } from "@/lib/imports/repository";
import { IMPORT_EXPIRED_NOTICE } from "@/lib/imports/recent";
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
    category: "other", subtype: null, ruleMatched: false, categorySource: null, notes: null, duplicateOf: null, importable: true,
    ...overrides,
  };
}

const draft: ImportDraft = {
  batch,
  rows: [
    aRow({ id: "a", description: "Cafe" }),
    aRow({ id: "b", description: "Lidl Cluj", amount: 45.2, duplicateOf: { id: "e1", description: "Lidl", expenseDate: "2026-10-12", amount: 45.2 } }),
    aRow({ id: "c", description: "Foreign shop", amount: 399, currency: "RON", importable: false }),
    aRow({ id: "d", description: "OMV 1642", amount: 300, category: "car", subtype: "car_fuel", ruleMatched: true, categorySource: "rule" }),
  ],
};

/** A statement the model read: a category from each source, and one nobody categorised. */
const readDraft: ImportDraft = {
  batch: { ...batch, sourceKind: "pdf", parserId: "ai:statement-reader-v1", skippedCredits: 1, rowCount: 5 },
  rows: [
    aRow({ id: "h", description: "Lidl Cluj", category: "groceries", categorySource: "history" }),
    aRow({ id: "m", description: "Netflix", category: "entertainment", categorySource: "ai" }),
    aRow({ id: "r", description: "OMV 1642", category: "car", subtype: "car_fuel", ruleMatched: true, categorySource: "rule" }),
    aRow({ id: "n", description: "Corner shop" }),
  ],
};

/** The text of some markup: tags removed, so a sentence with a link in the middle reads as one. */
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

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

  it("accepts a CSV up to 2 MB and a PDF up to 5 MB, and refuses everything else before any request", () => {
    expect(validateStatementFile(file("a.csv", 2 * 1024 * 1024))).toBeNull();
    expect(validateStatementFile(file("a.csv", 2 * 1024 * 1024 + 1))).toBe("Choose a statement under 2 MB.");
    expect(validateStatementFile(file("a.csv", 0))).toBe(EMPTY_STATEMENT_FILE);
    expect(validateStatementFile(file("a.xlsx"))).toBe(NOT_A_STATEMENT_FILE);
    expect(validateStatementFile(file("a.pdf", 5 * 1024 * 1024))).toBeNull();
    expect(validateStatementFile(file("a.pdf", 5 * 1024 * 1024 + 1))).toBe("Choose a statement under 5 MB.");
    expect(validateStatementFile(file("a.pdf", 0))).toBe(EMPTY_STATEMENT_FILE);
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

  it("treats a draft that was confirmed or undone meanwhile as a 409, since the route answers with the batch alone", async () => {
    stubFetch(new Response(JSON.stringify({ batch: { ...batch, status: "confirmed" } })));
    const caught = await restImportApi.getDraft("b1").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 409, message: "That import was already confirmed or undone." });
  });

  it("passes an expired draft's 404 on with the server's message", async () => {
    stubFetch(new Response(JSON.stringify({ error: "That import wasn't found or has expired." }), { status: 404 }));
    await expect(restImportApi.getDraft("b1")).rejects.toMatchObject({ status: 404 });
  });

  it("carries a refused upload's code on the ApiError, so the screen can tell refusals apart", async () => {
    stubFetch(new Response(JSON.stringify({ error: "This statement's layout isn't supported yet.", code: "unrecognised_layout" }), { status: 422 }));
    const caught = await restImportApi.upload(new File(["a"], "x.csv"), "text/csv").catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 422, code: "unrecognised_layout" });
  });

  it("carries a confirm's field errors on the ApiError", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Check the rows and try again.", fieldErrors: { "rows.1.amount": ["Too small."] } }), { status: 422 }));
    const caught = await restImportApi.confirm("b1", []).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).fieldErrors).toEqual({ "rows.1.amount": ["Too small."] });
  });
});

describe("UploadStep", () => {
  it("offers a picker for a CSV or a PDF and says the file is discarded", () => {
    const html = render(<UploadStep onFile={noop} pending={false} />);
    expect(html).toContain("Drop a statement here");
    expect(html).toContain("Choose a file");
    expect(html).toContain("or a PDF statement with");
    expect(html).not.toContain("coming soon");
    expect(html).toContain(DISCARD_NOTE);
    expect(DISCARD_NOTE).toBe("The file is read and discarded. Only the rows below are kept, for 24 hours.");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="\.csv,\.pdf"/);
  });

  it("shows why the last upload was refused, and a notice", () => {
    const html = render(<UploadStep onFile={noop} pending={false} error="This statement's layout isn't supported yet." notice="The import was discarded." />);
    expect(html).toContain("This statement&#x27;s layout isn&#x27;t supported yet.");
    expect(html).toContain("The import was discarded.");
  });
});

describe("the AI reading hint", () => {
  const sentence = "Turn on AI reading in Settings to import any bank's statement.";

  it("is the plan's sentence, linking to Settings → AI", () => {
    const html = render(<AiReadingHint />);
    expect(textOf(html)).toBe(sentence);
    expect(html).toMatch(/<a [^>]*href="\/settings\/ai"[^>]*>Settings<\/a>/);
  });

  it("shows on the upload step while AI is off", () => {
    const html = render(<UploadStep onFile={noop} pending={false} aiEnabled={false} />);
    expect(textOf(html)).toContain(sentence);
    expect(html).toContain('href="/settings/ai"');
    expect(html.match(/ai-reading-hint/g)).toHaveLength(1);
  });

  it("is absent when AI is on, and while it is not known yet", () => {
    for (const aiEnabled of [true, undefined]) {
      expect(render(<UploadStep onFile={noop} pending={false} aiEnabled={aiEnabled} />)).not.toContain("ai-reading-hint");
    }
  });

  it("follows an unrecognised_layout refusal, once, inside the refusal", () => {
    const html = render(
      <UploadStep onFile={noop} pending={false} aiEnabled={false} error="This statement's layout isn't supported yet." errorCode="unrecognised_layout" />,
    );
    const text = textOf(html);
    // Two blocks, the message and then the hint, so no space between them in the text.
    expect(text).toContain("This statement's layout isn't supported yet." + sentence);
    expect(html.match(/ai-reading-hint/g)).toHaveLength(1);
    expect(html.indexOf("ai-reading-hint")).toBeLessThan(html.indexOf("Drop a statement here"));
  });

  it("is the standing line, not part of the error, for any other refusal", () => {
    const html = render(
      <UploadStep onFile={noop} pending={false} aiEnabled={false} error="That file is empty." errorCode="empty_file" />,
    );
    expect(html.match(/ai-reading-hint/g)).toHaveLength(1);
    expect(html.indexOf("ai-reading-hint")).toBeGreaterThan(html.indexOf("Drop a statement here"));
  });

  it("is not added to a refusal when AI is on or unknown, whose layout message already says why", () => {
    for (const aiEnabled of [true, undefined]) {
      const html = render(
        <UploadStep onFile={noop} pending={false} aiEnabled={aiEnabled} error="AI reading is paused this month." errorCode="unrecognised_layout" />,
      );
      expect(html).not.toContain("ai-reading-hint");
    }
  });

  it("reads the refusal's code off an ApiError", () => {
    expect(uploadErrorCode(new ApiError("x", 422, undefined, "unrecognised_layout"))).toBe("unrecognised_layout");
    expect(uploadErrorCode(new ApiError("x", 422))).toBeUndefined();
    expect(uploadErrorCode(new Error("x"))).toBeUndefined();
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
    expect(html).toContain("Car / Car Fuel");
    expect(html).not.toContain('aria-label="Category for OMV 1642"');
    expect(html).toContain('aria-label="Category for Cafe"');
  });

  it("labels each row's category with where it came from, and leaves a row with no source bare", () => {
    const read = render(<ReviewTable items={initialReview(readDraft.rows)} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);
    expect([...read.matchAll(/data-category-source="(\w+)"[^>]*>([^<]+)</g)].map((match) => [match[1], match[2]])).toEqual([
      ["history", "Like last time"],
      ["ai", "AI suggestion"],
      ["rule", "Merchant rule"],
    ]);
    // The label sits under the category's select, not in place of it.
    expect(read.indexOf('aria-label="Category for Netflix"')).toBeLessThan(read.indexOf("AI suggestion"));
    // No source: no label. The classic CSV draft has only the rule row's.
    expect(html.match(/data-category-source/g)).toHaveLength(1);
    expect(html).toContain("Merchant rule");
    expect(html).not.toContain("AI suggestion");
  });

  it("drops the label once the user changes the category", () => {
    const items = initialReview(readDraft.rows).map((item) => (item.row.id === "m" ? { ...item, category: "shopping" as const, categorySource: null } : item));
    const changed = render(<ReviewTable items={items} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);
    expect(changed).not.toContain("AI suggestion");
    expect(changed).toContain("Like last time");
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

  describe("for a statement the model read", () => {
    const totals = "The rows read add up to 267.88, but the statement's printed total of money out is 280.28 (a difference of 12.40).";
    const lines = "3 lines with an amount weren't read as transactions.";
    const read = { ...props, draft: readDraft, warnings: [totals, lines] };

    it("shows both verification warnings in the summary area, above the rows", () => {
      const html = render(<ReviewStep {...read} />);
      const text = textOf(html);
      expect(text).toContain(totals);
      expect(text).toContain(lines);
      expect(text).toContain("AI-read statement");
      // After the summary line and before the first row (the table or the cards).
      expect(text.indexOf("5 rows")).toBeLessThan(text.indexOf(totals));
      expect(text.indexOf(totals)).toBeLessThan(text.indexOf(lines));
      expect(html.indexOf(lines)).toBeLessThan(html.indexOf("Transactions found in the statement"));
      expect(html).toMatch(/aria-label="Warnings about this statement"/);
    });

    it("labels the rows by source", () => {
      const html = render(<ReviewStep {...read} />);
      for (const label of ["Like last time", "AI suggestion", "Merchant rule"]) expect(html).toContain(label);
    });

    it("shows no warnings group when there are none, as for a draft that is resumed", () => {
      const html = render(<ReviewStep {...props} draft={readDraft} />);
      expect(html).not.toContain("Warnings about this statement");
      expect(html).not.toContain("weren't read as transactions");
    });
  });

  it("disables Add while nothing is ticked", () => {
    const none = { ...draft, rows: draft.rows.map((row) => ({ ...row, importable: false })) };
    expect(render(<ReviewStep {...props} draft={none} />)).toMatch(/<button[^>]*disabled[^>]*>Add expenses<\/button>/);
  });
});

describe("UploadStep notices", () => {
  it("shows an expired draft's notice above the picker, whatever its tone", () => {
    for (const noticeTone of ["warning", "info"] as const) {
      const html = render(<UploadStep onFile={noop} pending={false} notice={IMPORT_EXPIRED_NOTICE} noticeTone={noticeTone} />);
      expect(html.indexOf(IMPORT_EXPIRED_NOTICE)).toBeGreaterThan(-1);
      expect(html.indexOf(IMPORT_EXPIRED_NOTICE)).toBeLessThan(html.indexOf("Drop a statement here"));
    }
    expect(IMPORT_EXPIRED_NOTICE).toBe("This import has expired. Upload the statement again.");
  });
});

describe("ReviewCards", () => {
  const items = initialReview(draft.rows);
  const html = render(<ReviewCards items={items} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);

  it("is one card per row, not a table", () => {
    expect(html).not.toContain("<table");
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain("Transactions found in the statement");
  });

  it("has the tick box, the merchant, the amount, the date and the category in each card", () => {
    expect(html).toContain('aria-label="Add Cafe"');
    expect(html).toMatch(/<input[^>]*aria-label="Description of Cafe"[^>]*value="Cafe"/);
    expect(html).toContain("4.50");
    expect(html).toContain("Oct 12, 2026");
    expect(html).toContain('aria-label="Category for Cafe"');
  });

  it("ticks, flags and explains rows the way the table does", () => {
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*aria-label="Add ([^"]+)"[^>]*>/g)];
    expect(boxes.map((box) => [box[1], box[0].includes("checked=\"\""), box[0].includes("disabled")])).toEqual([
      ["Cafe", true, false],
      ["Lidl Cluj", false, false],
      ["Foreign shop", false, true],
      ["OMV 1642", true, false],
    ]);
    expect(html).toContain("Possible duplicate");
    expect(html).toMatch(/Looks like [\s\S]*?<em[^>]*>Lidl, 12 Oct, 45\.20<\/em>/);
    expect(html).toContain("In RON. Your account is in EUR, so this can&#x27;t be imported.");
    expect(html).toContain("Merchant rule");
    expect(html).not.toContain('aria-label="Category for OMV 1642"');
  });

  it("labels where each category came from on a phone too", () => {
    const read = render(<ReviewCards items={initialReview(readDraft.rows)} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />);
    for (const label of ["Like last time", "AI suggestion", "Merchant rule"]) expect(read).toContain(label);
    expect(read.match(/data-category-source/g)).toHaveLength(3);
  });

  it("shows a server message under its row, and a blank description on a ticked row", () => {
    const shown = render(<ReviewCards items={items} accountCurrency="EUR" rowErrors={{ a: "Amount must be greater than zero." }} dispatch={noop} />);
    expect(shown).toContain("Amount must be greater than zero.");
    const blank = initialReview([aRow({ id: "x", description: "" })]);
    expect(render(<ReviewCards items={blank} accountCurrency="EUR" rowErrors={{}} dispatch={noop} />)).toContain("Enter a description.");
  });
});

describe("RecentImportsList", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const confirmedBatch: ImportBatch = {
    ...batch, id: "b2", status: "confirmed", expiresAt: null, confirmedAt: "2026-10-03T09:00:00Z", confirmedCount: 37,
    createdAt: "2026-10-03T08:00:00Z", rowCount: 37,
  };
  const undoneBatch: ImportBatch = { ...confirmedBatch, id: "b3", status: "undone", undoneAt: "2026-10-05T09:00:00Z" };
  const imports: RecentImport[] = [
    { batch: { ...batch, rowCount: 37, createdAt: "2026-10-28T17:00:00Z", expiresAt: "2026-10-29T17:00:00Z" }, expenseCount: 0, changedCount: 0 },
    { batch: confirmedBatch, expenseCount: 37, changedCount: 2 },
    { batch: undoneBatch, expenseCount: 0, changedCount: 0 },
  ];
  const html = render(<RecentImportsList imports={imports} now={now} onResume={noop} onDiscard={noop} onUndo={noop} />);
  const rows = html.split("<li ").slice(1);

  it("lists a draft with its rows and time left, and Resume and Discard", () => {
    expect(rows[0]).toContain("Statement of 1 Oct to 31 Oct 2026");
    expect(rows[0]).toContain("37 rows · uploaded 28 Oct · expires in 5 h");
    expect(rows[0]).toContain(">Draft<");
    expect(rows[0]).toMatch(/<button[^>]*aria-label="Resume Statement of 1 Oct to 31 Oct 2026"/);
    expect(rows[0]).toMatch(/<button[^>]*aria-label="Discard Statement of 1 Oct to 31 Oct 2026"/);
    expect(rows[0]).not.toContain("Undo");
  });

  it("lists a confirmed import with its expenses, the day, and Undo", () => {
    expect(rows[1]).toContain("37 expenses · imported 3 Oct");
    expect(rows[1]).toContain(">Imported<");
    expect(rows[1]).toMatch(/<button[^>]*aria-label="Undo Statement of 1 Oct to 31 Oct 2026"/);
    expect(rows[1]).not.toContain("Resume");
  });

  it("shows an undone import as such, without a button", () => {
    expect(rows[2]).toContain("37 expenses · undone 5 Oct");
    expect(rows[2]).toContain(">Undone<");
    expect(rows[2]).not.toContain("<button");
  });

  it("disables the buttons while a request is in flight", () => {
    const busy = render(<RecentImportsList imports={imports} now={now} disabled onResume={noop} onDiscard={noop} onUndo={noop} />);
    expect([...busy.matchAll(/<button[^>]*>/g)].every((button) => button[0].includes("disabled"))).toBe(true);
  });
});

describe("RecentImports", () => {
  const confirmedBatch: ImportBatch = {
    ...batch, id: "b2", status: "confirmed", expiresAt: null, confirmedAt: "2026-10-03T09:00:00Z", confirmedCount: 37,
  };
  const withData = (response: ImportsResponse) => render(
    <SWRConfig value={{ fallback: { [IMPORTS_API_KEY]: response }, revalidateOnMount: false }}>
      <RecentImports onResume={noop} />
    </SWRConfig>,
  );

  it("shows the section with its title when there are imports", () => {
    const html = withData({ imports: [{ batch: confirmedBatch, expenseCount: 37, changedCount: 2 }] });
    expect(html).toContain("Recent imports");
    expect(html).toContain("Your last 20. A draft is kept for 24 hours.");
    expect(html).toContain("37 expenses");
  });

  it("shows nothing when there are no imports", () => {
    expect(withData({ imports: [] })).not.toContain("Recent imports");
  });
});

describe("undo dialog wording", () => {
  it("says the counts and what stays", () => {
    expect(undoDescription({ expenseCount: 37, changedCount: 2 }, "3 October")).toBe(
      "This removes 37 expenses you imported on 3 October, 2 of them changed since. Expenses you added yourself stay. The statement can be imported again afterwards.",
    );
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
