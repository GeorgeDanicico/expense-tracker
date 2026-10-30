import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PricingTable } from "@/lib/ai/pricing";
import { FakeProvider } from "@/lib/ai/providers/fake";
import { addDays, getBucharestToday } from "@/lib/calendar";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import { statementHash } from "@/lib/imports/hash";
import { ImportError } from "@/lib/imports/types";
import { anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { buildTextPdf, type PdfPage } from "@/test/pdf";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { createDraft, type CreateDraftDependencies } from "@/lib/imports/service";

/**
 * The statement reader end to end (docs/statement-import-plan.md, task I17): an upload through the
 * service, the gate and the fake provider, to the draft the fake import repository stores. Every
 * model answer here is a recorded one, written by hand for a synthetic statement; nothing is
 * called over the network.
 */

const userId = "10000000-0000-4000-8000-000000000001";
const now = new Date();

// A price that makes the ledger easy to read: a micro per input token, ten per output token.
const PRICING: PricingTable = {
  fake: { "fake-model": { inputPerMillionMicros: 1_000_000, cachedInputPerMillionMicros: 100_000, outputPerMillionMicros: 10_000_000, standardInputTokens: 100_000 } },
};

let repositories: FakeRepositories;
let provider: FakeProvider;
let logged: Record<string, unknown>[];

function dependencies(): CreateDraftDependencies {
  return {
    ai: { provider, pricing: PRICING, env: { AI_MODEL_STATEMENTS: "fake-model" }, log: () => undefined },
    log: (line) => logged.push(line),
  };
}

beforeEach(() => {
  repositories = resetFakeRepositories();
  repositories.imports.now = () => now;
  repositories.aiGate.setUser(userId, { optedIn: true });
  provider = new FakeProvider();
  logged = [];
});

const csv = (...lines: string[]) => ({
  kind: "csv" as const,
  bytes: new TextEncoder().encode(`Date,Description,Amount,Currency\n${lines.join("\n")}\n`),
});
const pdf = (...pages: PdfPage[]) => ({ kind: "pdf" as const, bytes: buildTextPdf(pages) });

async function refusal(promise: Promise<unknown>): Promise<ImportError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportError);
    return error as ImportError;
  }
  throw new Error("expected the upload to be refused");
}

/** The rows of the one stored draft as the review screen would see them: description, category, subtype, source. */
function storedRows() {
  const [batch] = repositories.imports.batches;
  return repositories.imports
    .rowsOf(batch.id)
    .map((row) => [row.description, row.category, row.subtype, row.categorySource] as const);
}

// ---------------------------------------------------------------------------------------------
// Mode "categorise": a parser reads the rows, the model only categorises unknown merchants.
// ---------------------------------------------------------------------------------------------

describe("a CSV a parser reads (mode categorise)", () => {
  const statement = () =>
    csv(
      "2026-10-02,Corner Cafe,-4.50,RON",
      "2026-10-03,Fresh Market 1234,-123.40,RON",
      "2026-10-04,Pharmacy Green,-37.25,RON",
      "2026-10-05,Corner Cafe,-6.00,RON",
      "2026-10-06,Salary,2500,RON",
      "2026-10-07,OMV 1642 Satu Mare,-300.00,RON",
    );

  beforeEach(() => {
    // The user once gave "Fresh Market" a category by hand.
    repositories.expenses.expenses.set(userId, [
      anExpense({ id: "a", description: "Fresh Market 7", category: "groceries", expenseDate: addDays(getBucharestToday(), -20) }),
    ]);
  });

  it("sends only the merchants neither the merchant rule nor the user's history knows, once each", async () => {
    provider.willReturn({ k: [{ c: "entertainment", s: null }, { c: "health", s: null }] });

    const { batch, warnings } = await createDraft(userId, statement(), now, dependencies());

    expect(provider.requests).toHaveLength(1);
    const [request] = provider.requests;
    expect(request.input).toBe("Corner Cafe\nPharmacy Green");
    expect(request.schemaName).toBe("statement_categories");
    expect(request.effort).toBe("none");
    expect(request.system).toContain("statement-categorise-v1");
    expect(request.maxOutputTokens).toBeGreaterThanOrEqual(256);
    expect(request.maxOutputTokens).toBeLessThan(2000);
    // Nothing about the user and nothing from the rows beyond the merchant names.
    expect(request.input).not.toMatch(/2026|123\.40|Salary|Fresh|OMV|groceries/);

    expect(batch).toMatchObject({ parserId: "generic-csv+ai:statement-categorise-v1", rowCount: 5, skippedCredits: 1 });
    expect(warnings).toEqual([]);
    expect(storedRows()).toEqual([
      ["Corner Cafe", "entertainment", null, "ai"],
      ["Fresh Market 1234", "groceries", null, "history"],
      ["Pharmacy Green", "health", null, "ai"],
      ["Corner Cafe", "entertainment", null, "ai"],
      // The merchant rule inside create_import_batch wins and names itself.
      ["OMV 1642 Satu Mare", "car", "car_fuel", "rule"],
    ]);
  });

  it("records the call in the ledger", async () => {
    provider.willReturn({ k: [{ c: "entertainment", s: null }, { c: "health", s: null }] });

    await createDraft(userId, statement(), now, dependencies());

    expect(repositories.aiGate.usage).toHaveLength(1);
    expect(repositories.aiGate.usage[0]).toMatchObject({ userId, feature: "statements", provider: "fake", outcome: "ok", inputTokens: 1000, outputTokens: 200 });
  });

  it("keeps the content hash of the rows, as for a statement a parser reads without AI", async () => {
    provider.willReturn({ k: [{ c: "entertainment", s: null }, { c: "health", s: null }] });

    await createDraft(userId, statement(), now, dependencies());

    const debits = [
      ["2026-10-02", "Corner Cafe", 4.5], ["2026-10-03", "Fresh Market 1234", 123.4], ["2026-10-04", "Pharmacy Green", 37.25],
      ["2026-10-05", "Corner Cafe", 6], ["2026-10-07", "OMV 1642 Satu Mare", 300],
    ] as const;
    expect(repositories.imports.batches[0].contentHash).toBe(
      statementHash(debits.map(([expenseDate, description, amount]) => ({ expenseDate, description, amount, currency: "RON" }))),
    );
  });

  it("makes no call when every merchant is known", async () => {
    const known = csv("2026-10-03,Fresh Market 1234,-123.40,RON", "2026-10-07,OMV 1642 Satu Mare,-300.00,RON");

    const { batch } = await createDraft(userId, known, now, dependencies());

    expect(provider.requests).toHaveLength(0);
    expect(batch.parserId).toBe("generic-csv");
    expect(storedRows()).toEqual([
      ["Fresh Market 1234", "groceries", null, "history"],
      ["OMV 1642 Satu Mare", "car", "car_fuel", "rule"],
    ]);
    expect(repositories.aiGate.usage).toHaveLength(0);
  });

  it("uses only the history of the user, and the most recent category of a merchant", async () => {
    repositories.expenses.expenses.set(userId, [
      anExpense({ id: "old", description: "Corner Cafe", category: "shopping", expenseDate: addDays(getBucharestToday(), -200) }),
      anExpense({ id: "new", description: "CORNER CAFE 5", category: "entertainment", expenseDate: addDays(getBucharestToday(), -10) }),
      anExpense({ id: "other", description: "Pharmacy Green", category: "other", expenseDate: addDays(getBucharestToday(), -10) }),
      anExpense({ id: "ancient", description: "Pharmacy Green", category: "health", expenseDate: addDays(getBucharestToday(), -400) }),
    ]);
    repositories.expenses.expenses.set("20000000-0000-4000-8000-000000000002", [
      anExpense({ id: "theirs", description: "Pharmacy Green", category: "travel", expenseDate: addDays(getBucharestToday(), -5) }),
    ]);
    provider.willReturn({ k: [{ c: "health", s: null }] });

    await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-04,Pharmacy Green,-37.25,RON"), now, dependencies());

    // Other says nothing about a merchant, a year-old choice is out of reach, and another user's is none of ours.
    expect(provider.requests[0].input).toBe("Pharmacy Green");
    expect(storedRows()).toEqual([
      ["Corner Cafe", "entertainment", null, "history"],
      ["Pharmacy Green", "health", null, "ai"],
    ]);
  });

  it("gives the model's car subtype to a car merchant, and drops one it gave to anything else", async () => {
    provider.willReturn({ k: [{ c: "car", s: "car_repairs" }, { c: "health", s: "car_fuel" }] });

    await createDraft(userId, csv("2026-10-02,Garage Synthetic,-400.00,RON", "2026-10-04,Pharmacy Green,-37.25,RON"), now, dependencies());

    expect(storedRows()).toEqual([
      ["Garage Synthetic", "car", "car_repairs", "ai"],
      ["Pharmacy Green", "health", null, "ai"],
    ]);
  });

  it.each([
    ["is refused", () => provider.willFail("refusal", { inputTokens: 50, outputTokens: 0, cachedInputTokens: 0 }), "refusal"],
    ["is cut off at the output cap", () => provider.willFail("max_tokens", { inputTokens: 50, outputTokens: 300, cachedInputTokens: 0 }), "max_tokens"],
    ["fails", () => provider.willFail("provider_error", null), "provider_error"],
    ["is not the shape asked for", () => provider.willReturn({ k: "none" }), "invalid_output"],
  ])("leaves the merchants as Other with a warning when the answer %s", async (_name, script, outcome) => {
    script();

    const { batch, warnings } = await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-03,Fresh Market 1234,-123.40,RON"), now, dependencies());

    expect(batch.parserId).toBe("generic-csv");
    expect(warnings).toEqual(["Categories couldn't be suggested this time, so the payments are left as Other."]);
    expect(storedRows()).toEqual([
      ["Corner Cafe", "other", null, null],
      // The history is applied regardless of the model.
      ["Fresh Market 1234", "groceries", null, "history"],
    ]);
    expect(repositories.aiGate.usage.map((row) => row.outcome)).toEqual([outcome]);
  });

  it("drops an answer that has another number of entries than the names it was asked about", async () => {
    provider.willReturn({ k: [{ c: "health", s: null }] });

    const { batch, warnings } = await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-04,Pharmacy Green,-37.25,RON"), now, dependencies());

    expect(batch.parserId).toBe("generic-csv");
    expect(warnings).toHaveLength(1);
    expect(storedRows()).toEqual([["Corner Cafe", "other", null, null], ["Pharmacy Green", "other", null, null]]);
  });

  it("leaves the unknown merchants as Other, with the gate's reason, when the family's month is used up", async () => {
    repositories.aiGate.seedUsage(userId, 3_000_000, new Date());

    const { warnings } = await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-03,Fresh Market 1234,-123.40,RON"), now, dependencies());

    expect(provider.requests).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Categories weren't suggested, so the payments are left as Other\. .*used up/);
    expect(storedRows()).toEqual([
      ["Corner Cafe", "other", null, null],
      ["Fresh Market 1234", "groceries", null, "history"],
    ]);
  });

  it("leaves them as Other when the kill switch is off", async () => {
    repositories.aiGate.enabled = false;

    const { warnings } = await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON"), now, dependencies());

    expect(provider.requests).toHaveLength(0);
    expect(warnings[0]).toContain("AI features are paused for everyone");
    expect(storedRows()).toEqual([["Corner Cafe", "other", null, null]]);
  });

  it("still imports when the history can't be read", async () => {
    vi.spyOn(repositories.expenses, "recentCategoriesByMerchant").mockRejectedValue(new Error("down"));
    provider.willReturn({ k: [{ c: "entertainment", s: null }, { c: "groceries", s: null }] });

    await createDraft(userId, csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-03,Fresh Market 1234,-123.40,RON"), now, dependencies());

    expect(provider.requests[0].input).toBe("Corner Cafe\nFresh Market 1234");
    expect(storedRows().map((row) => row[3])).toEqual(["ai", "ai"]);
  });
});

describe("a CSV with AI off", () => {
  const statement = () => csv("2026-10-02,Corner Cafe,-4.50,RON", "2026-10-07,OMV 1642 Satu Mare,-300.00,RON");

  it.each([
    ["the user never opted in", () => repositories.aiGate.users.delete(userId)],
    ["the user switched it off", () => repositories.aiGate.setUser(userId, { optedIn: false })],
    ["a kid has no permission", () => repositories.aiGate.setUser(userId, { familyId: "f", role: "kid", optedIn: true, kidAiPermission: false })],
  ])("goes through the parser unchanged, calls no model and reads no history when %s", async (_name, turnOff) => {
    turnOff();
    const history = vi.spyOn(repositories.expenses, "recentCategoriesByMerchant");

    const { batch, warnings } = await createDraft(userId, statement(), now, dependencies());

    expect(batch).toMatchObject({ parserId: "generic-csv", rowCount: 2 });
    expect(warnings).toEqual([]);
    expect(provider.requests).toHaveLength(0);
    expect(history).not.toHaveBeenCalled();
    expect(repositories.aiGate.usage).toHaveLength(0);
    expect(logged).toEqual([]);
    // The database's rule is all that categorises, as before.
    expect(storedRows()).toEqual([
      ["Corner Cafe", "other", null, null],
      ["OMV 1642 Satu Mare", "car", "car_fuel", "rule"],
    ]);
  });

  it("refuses an unfamiliar PDF as before: unrecognised_layout, with no call", async () => {
    repositories.aiGate.users.delete(userId);

    const error = await refusal(createDraft(userId, pdf(["Synthetic statement", ["02.10.2026", "Corner Cafe", "-12,50"]]), now, dependencies()));

    expect(error).toMatchObject({ code: "unrecognised_layout", status: 422, message: "This statement's layout isn't supported yet." });
    expect(provider.requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Mode "read": no parser claims the layout, so the model reads the numbered text.
// ---------------------------------------------------------------------------------------------

type Row = ReaderAnswer["r"][number];

/** A PDF with columns: money out and in, and a printed total. Lines (numbered from 1 over both pages, page markers excluded). */
const columnsPdf = (total = "357,70") =>
  pdf(
    [
      "Synthetic Bank current account statement",
      "Statement period 01.10.2026 - 31.10.2026 Currency RON",
      ["Date", "Description", "Amount"],
      ["02.10.2026", "POS 4411 LIDL CLUJ RO", "-45,20"],
      ["03.10.2026", "PLATA CARD CORNER CAFE", "-12,50"],
      ["05.10.2026", "SALARY SYNTHETIC EMPLOYER", "2.500,00"],
    ],
    [
      ["07.10.2026", "OMV 1642 SATU MARE", "-300,00"],
      ["Total payments", total],
    ],
  );

const LIDL: Row = { l: [4], d: "02.10.2026", a: "-45,20", c: null, t: "d", m: "Lidl Cluj" };
const CAFE: Row = { l: [5], d: "03.10.2026", a: "-12,50", c: null, t: "d", m: "Corner Cafe" };
const SALARY: Row = { l: [6], d: "05.10.2026", a: "2.500,00", c: null, t: "c", m: "Salary Synthetic Employer" };
const OMV: Row = { l: [7], d: "07.10.2026", a: "-300,00", c: null, t: "d", m: "OMV 1642 Satu Mare" };

const CATEGORIES: ReaderAnswer["k"] = [
  { m: "Lidl Cluj", c: "groceries", s: null },
  { m: "Corner Cafe", c: "entertainment", s: null },
  { m: "Salary Synthetic Employer", c: "other", s: null },
  { m: "OMV 1642 Satu Mare", c: "car", s: "car_fuel" },
];

function reading(overrides: Partial<ReaderAnswer> = {}): ReaderAnswer {
  return { r: [LIDL, CAFE, SALARY, OMV], k: CATEGORIES, s: { c: "RON", t: "357,70", l: 8 }, ...overrides };
}

describe("a PDF no parser reads (mode read)", () => {
  it("turns a recorded reading into the expected draft: columns, money in and out, printed total", async () => {
    provider.willReturn(reading());

    const { batch, reopened, warnings } = await createDraft(userId, columnsPdf(), now, dependencies());

    const [request] = provider.requests;
    expect(request.system).toContain("statement-reader-v1");
    expect(request.schemaName).toBe("statement_reading");
    expect(request.effort).toBe("none");
    expect(request.input.split("\n")).toEqual([
      "--- page 1 ---",
      "0001\tSynthetic Bank current account statement",
      "0002\tStatement period 01.10.2026 - 31.10.2026 Currency RON",
      "0003\tDate\tDescription\tAmount",
      "0004\t02.10.2026\tPOS 4411 LIDL CLUJ RO\t-45,20",
      "0005\t03.10.2026\tPLATA CARD CORNER CAFE\t-12,50",
      "0006\t05.10.2026\tSALARY SYNTHETIC EMPLOYER\t2.500,00",
      "--- page 2 ---",
      "0007\t07.10.2026\tOMV 1642 SATU MARE\t-300,00",
      "0008\tTotal payments\t357,70",
    ]);

    expect(reopened).toBe(false);
    expect(warnings).toEqual([]);
    expect(batch).toMatchObject({
      status: "draft",
      sourceKind: "pdf",
      parserId: "ai:statement-reader-v1",
      currency: "RON",
      periodStart: "2026-10-02",
      periodEnd: "2026-10-07",
      rowCount: 3,
      skippedCredits: 1,
    });
    expect(repositories.imports.rows.map((row) => [row.position, row.expenseDate, row.description, row.amount, row.currency])).toEqual([
      [1, "2026-10-02", "Lidl Cluj", 45.2, "RON"],
      [2, "2026-10-03", "Corner Cafe", 12.5, "RON"],
      [3, "2026-10-07", "OMV 1642 Satu Mare", 300, "RON"],
    ]);
    expect(storedRows()).toEqual([
      ["Lidl Cluj", "groceries", null, "ai"],
      ["Corner Cafe", "entertainment", null, "ai"],
      ["OMV 1642 Satu Mare", "car", "car_fuel", "rule"],
    ]);
  });

  it("hashes the masked, numbered text, not the rows", async () => {
    provider.willReturn(reading());

    await createDraft(userId, columnsPdf(), now, dependencies());

    expect(repositories.imports.batches[0].contentHash).toBe(createHash("sha256").update(provider.requests[0].input).digest("hex"));
  });

  it("sizes the output cap from the lines that look like transactions", async () => {
    provider.willReturn(reading());

    await createDraft(userId, columnsPdf(), now, dependencies());

    // Four transaction lines (the printed total has no date): (100 + 45 * 4) * 1.5.
    expect(provider.requests[0].maxOutputTokens).toBe(420);
  });

  it("takes the user's history before the model's category, and never sends it", async () => {
    repositories.expenses.expenses.set(userId, [
      anExpense({ id: "a", description: "Lidl Cluj 7", category: "shopping", expenseDate: addDays(getBucharestToday(), -20) }),
    ]);
    provider.willReturn(reading());

    await createDraft(userId, columnsPdf(), now, dependencies());

    expect(provider.requests[0].input).not.toContain("shopping");
    expect(storedRows()[0]).toEqual(["Lidl Cluj", "shopping", null, "history"]);
    expect(storedRows()[1]).toEqual(["Corner Cafe", "entertainment", null, "ai"]);
  });

  it("reads a transaction written on two lines", async () => {
    provider.willReturn({
      r: [
        { l: [2, 3], d: "03.10.2026", a: "-89,90", c: null, t: "d", m: "Pharmacy Green Cluj" },
        { l: [4, 5], d: "04.10.2026", a: "-15,00", c: null, t: "d", m: "Bookstore Synthetic" },
      ],
      k: [{ m: "Pharmacy Green Cluj", c: "health", s: null }, { m: "Bookstore Synthetic", c: "education", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    const { warnings } = await createDraft(
      userId,
      pdf([
        "Synthetic card statement October 2026 Currency RON",
        ["03.10.2026", "CARD PAYMENT", "-89,90"],
        "PHARMACY GREEN CLUJ",
        ["04.10.2026", "CARD PAYMENT", "-15,00"],
        "BOOKSTORE SYNTHETIC",
      ]),
      now,
      dependencies(),
    );

    expect(warnings).toEqual([]);
    expect(storedRows()).toEqual([
      ["Pharmacy Green Cluj", "health", null, "ai"],
      ["Bookstore Synthetic", "education", null, "ai"],
    ]);
  });

  it("keeps a foreign-currency row as it is, in its own currency", async () => {
    provider.willReturn({
      r: [
        { l: [2], d: "12.10.2026", a: "-120,00", c: "EUR", t: "d", m: "Hotel Synthetic Berlin" },
        { l: [3], d: "13.10.2026", a: "-9,50", c: null, t: "d", m: "Corner Cafe" },
      ],
      k: [{ m: "Hotel Synthetic Berlin", c: "travel", s: null }, { m: "Corner Cafe", c: "entertainment", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    const { batch } = await createDraft(
      userId,
      pdf(["Synthetic travel card statement Currency RON", ["12.10.2026", "HOTEL SYNTHETIC BERLIN DE", "-120,00 EUR"], ["13.10.2026", "CORNER CAFE", "-9,50"]]),
      now,
      dependencies(),
    );

    expect(batch.currency).toBe("RON");
    expect(repositories.imports.rows.map((row) => [row.description, row.amount, row.currency])).toEqual([
      ["Hotel Synthetic Berlin", 120, "EUR"],
      ["Corner Cafe", 9.5, "RON"],
    ]);
  });

  it("masks an IBAN before the text leaves, and keeps it out of the draft", async () => {
    provider.willReturn({
      r: [{ l: [2], d: "03.10.2026", a: "-89,90", c: null, t: "d", m: "Pharmacy Green" }],
      k: [{ m: "Pharmacy Green", c: "health", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    await createDraft(
      userId,
      pdf(["Account RO00 FAKE 0000 0000 0000 0001 Currency RON", ["03.10.2026", "PHARMACY GREEN", "-89,90"]]),
      now,
      dependencies(),
    );

    expect(provider.requests[0].input).not.toContain("RO00");
    expect(provider.requests[0].input).toContain("Account …0001 Currency RON");
  });

  it("reads a CSV in a layout no parser knows", async () => {
    provider.willReturn({
      r: [{ l: [2], d: "02/10/2026", a: "4,50", c: null, t: "d", m: "Corner Cafe" }],
      k: [{ m: "Corner Cafe", c: "entertainment", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    const { batch } = await createDraft(
      userId,
      { kind: "csv", bytes: new TextEncoder().encode("Booking;Narrative text;Value RON\n02/10/2026;CORNER CAFE;4,50\n") },
      now,
      dependencies(),
    );

    expect(batch).toMatchObject({ sourceKind: "csv", parserId: "ai:statement-reader-v1", rowCount: 1 });
  });

  it("opens the same statement again as the same draft", async () => {
    provider.willReturn(reading());
    const first = await createDraft(userId, columnsPdf(), now, dependencies());
    provider.willReturn(reading());

    const second = await createDraft(userId, columnsPdf(), now, dependencies());

    expect(second.reopened).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Tampered answers: code finds nothing wrong with the text, and everything wrong with the model.
// ---------------------------------------------------------------------------------------------

describe("a tampered reading", () => {
  const UNVERIFIED = { code: "unverified_statement", status: 422, message: "The statement couldn't be read reliably." };

  async function expectRefusal(answer: ReaderAnswer, pdfFile = columnsPdf()) {
    provider.willReturn(answer);
    const error = await refusal(createDraft(userId, pdfFile, now, dependencies()));
    expect(error).toMatchObject(UNVERIFIED);
    // Nothing is drafted, and the call is recorded all the same.
    expect(repositories.imports.batches).toHaveLength(0);
    expect(repositories.aiGate.usage).toHaveLength(1);
    return error;
  }

  it("refuses an amount that is not on its line", async () => {
    await expectRefusal(reading({ r: [{ ...LIDL, a: "-54,20" }, CAFE, SALARY, OMV] }));
    expect(logged).toContainEqual({ mode: "read", outcome: "unverified", reason: "amount_not_found", row: 0 });
  });

  it("refuses a date changed by a day", async () => {
    await expectRefusal(reading({ r: [LIDL, { ...CAFE, d: "04.10.2026" }, SALARY, OMV] }));
    expect(logged).toContainEqual({ mode: "read", outcome: "unverified", reason: "date_not_found", row: 1 });
  });

  it("refuses an invented merchant word", async () => {
    await expectRefusal(reading({ r: [LIDL, CAFE, SALARY, { ...OMV, m: "OMV Shell Satu Mare" }] }));
    expect(logged).toContainEqual({ mode: "read", outcome: "unverified", reason: "merchant_not_found", row: 3 });
  });

  it("refuses a line used for two transactions' amounts", async () => {
    await expectRefusal(reading({ r: [LIDL, { ...LIDL, m: "Lidl Cluj" }, CAFE, SALARY, OMV] }));
    expect(logged).toContainEqual({ mode: "read", outcome: "unverified", reason: "line_reused", row: 1 });
  });

  it("refuses a line that doesn't exist", async () => {
    await expectRefusal(reading({ r: [{ ...LIDL, l: [40] }, CAFE, SALARY, OMV] }));
  });

  it("never writes the statement's text in its log", async () => {
    await expectRefusal(reading({ r: [{ ...LIDL, a: "-54,20" }, CAFE, SALARY, OMV] }));

    const text = JSON.stringify(logged);
    expect(text).not.toMatch(/LIDL|Lidl|45,20|54,20|Synthetic/);
  });

  it("drafts a missing row, with a warning that a line wasn't read", async () => {
    provider.willReturn(reading({ r: [LIDL, SALARY, OMV], s: { c: "RON", t: null, l: null } }));

    const { batch, warnings } = await createDraft(userId, columnsPdf(), now, dependencies());

    expect(batch.rowCount).toBe(2);
    expect(warnings).toEqual(["1 line with an amount wasn't read as a transaction."]);
  });

  it("drafts rows whose total differs from the printed one, with a warning that gives the difference", async () => {
    provider.willReturn(reading({ r: [LIDL, SALARY, OMV] }));

    const { batch, warnings } = await createDraft(userId, columnsPdf(), now, dependencies());

    expect(batch.rowCount).toBe(2);
    expect(warnings).toEqual([
      "The rows read add up to 345.20, but the statement's printed total of money out is 357.70 (a difference of 12.50).",
      "1 line with an amount wasn't read as a transaction.",
    ]);
  });

  it("warns when the statement itself prints a total the rows don't add up to", async () => {
    provider.willReturn(reading({ s: { c: "RON", t: "367,70", l: 8 } }));

    const { warnings } = await createDraft(userId, columnsPdf("367,70"), now, dependencies());

    expect(warnings).toEqual([
      "The rows read add up to 357.70, but the statement's printed total of money out is 367.70 (a difference of 10.00).",
    ]);
  });

  it("leaves a merchant missing from k as Other and says so", async () => {
    provider.willReturn(reading({ k: CATEGORIES.filter((entry) => entry.m !== "Corner Cafe") }));

    const { warnings } = await createDraft(userId, columnsPdf(), now, dependencies());

    expect(warnings).toEqual(["1 merchant wasn't categorised and is left as Other."]);
    expect(storedRows()).toEqual([
      ["Lidl Cluj", "groceries", null, "ai"],
      ["Corner Cafe", "other", null, null],
      ["OMV 1642 Satu Mare", "car", "car_fuel", "rule"],
    ]);
  });

  it("refuses an answer cut off at the output cap, and records what it cost", async () => {
    provider.willFail("max_tokens", { inputTokens: 900, outputTokens: 420, cachedInputTokens: 0 });

    const error = await refusal(createDraft(userId, columnsPdf(), now, dependencies()));

    expect(error).toMatchObject(UNVERIFIED);
    expect(repositories.imports.batches).toHaveLength(0);
    expect(repositories.aiGate.usage).toMatchObject([{ outcome: "max_tokens", inputTokens: 900, outputTokens: 420 }]);
  });

  it("refuses an answer the model declined to give", async () => {
    provider.willFail("refusal", { inputTokens: 900, outputTokens: 5, cachedInputTokens: 0 });

    expect(await refusal(createDraft(userId, columnsPdf(), now, dependencies()))).toMatchObject(UNVERIFIED);
  });

  it("refuses an answer that isn't the shape asked for", async () => {
    provider.willReturn({ r: "everything" });

    expect(await refusal(createDraft(userId, columnsPdf(), now, dependencies()))).toMatchObject(UNVERIFIED);
    expect(repositories.aiGate.usage.map((row) => row.outcome)).toEqual(["invalid_output"]);
  });

  it("refuses a statement whose amounts can't be read without guessing", async () => {
    provider.willReturn({
      r: [{ l: [2], d: "03.10.2026", a: "-1.234", c: null, t: "d", m: "Pharmacy Green" }],
      k: [{ m: "Pharmacy Green", c: "health", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    const error = await refusal(createDraft(userId, pdf(["Synthetic Currency RON", ["03.10.2026", "PHARMACY GREEN", "-1.234"]]), now, dependencies()));

    expect(error).toMatchObject({ code: "ambiguous_amounts", status: 422 });
  });

  it("refuses a statement that doesn't say which currency it is in", async () => {
    provider.willReturn({
      r: [{ l: [2], d: "03.10.2026", a: "-89,90", c: null, t: "d", m: "Pharmacy Green" }],
      k: [{ m: "Pharmacy Green", c: "health", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    const error = await refusal(createDraft(userId, pdf(["Synthetic statement", ["03.10.2026", "PHARMACY GREEN", "-89,90"]]), now, dependencies()));

    expect(error).toMatchObject({ code: "unreadable_statement", message: "This statement doesn't say which currency its amounts are in." });
  });

  it("answers no_debits for a statement of money in only", async () => {
    provider.willReturn({
      r: [SALARY],
      k: [{ m: "Salary Synthetic Employer", c: "other", s: null }],
      s: { c: "RON", t: null, l: null },
    });

    expect(await refusal(createDraft(userId, columnsPdf(), now, dependencies()))).toMatchObject({ code: "no_debits" });
  });

  it("refuses more than 500 debits", async () => {
    const lines = Array.from({ length: 501 }, (_, index) => `02.10.2026 SHOP ${index + 1} -1,00`);
    const rows: Row[] = lines.map((_, index) => ({ l: [index + 2], d: "02.10.2026", a: "-1,00", c: null, t: "d", m: `Shop ${index + 1}` }));
    provider.willReturn({ r: rows, k: [], s: { c: "RON", t: null, l: null } });

    const error = await refusal(
      createDraft(
        userId,
        { kind: "csv", bytes: new TextEncoder().encode(["Booking;Narrative text;Value RON", ...lines].join("\n")) },
        now,
        dependencies(),
      ),
    );

    expect(error).toMatchObject({ code: "too_many_rows" });
  });
});

// ---------------------------------------------------------------------------------------------
// When the model can't be asked or doesn't answer.
// ---------------------------------------------------------------------------------------------

describe("a PDF that needs the model when it can't be used", () => {
  it.each([
    ["the family's month is used up", () => repositories.aiGate.seedUsage(userId, 3_000_000, new Date()), /used up/],
    ["the kill switch is off", () => { repositories.aiGate.enabled = false; }, /paused for everyone/],
  ])("is refused with the reason, and nothing is drafted, when %s", async (_name, setUp, reason) => {
    setUp();

    const error = await refusal(createDraft(userId, columnsPdf(), now, dependencies()));

    expect(error).toMatchObject({ code: "unrecognised_layout", status: 422 });
    expect(error.message).toMatch(/^This statement's layout isn't supported yet, and the AI reader can't be used right now\. /);
    expect(error.message).toMatch(reason);
    expect(provider.requests).toHaveLength(0);
    expect(repositories.imports.batches).toHaveLength(0);
  });

  it("is refused when the server has no model set up", async () => {
    const error = await refusal(createDraft(userId, columnsPdf(), now, { ...dependencies(), ai: { provider, pricing: PRICING, env: {}, log: () => undefined } }));

    expect(error).toMatchObject({ code: "unrecognised_layout" });
    expect(error.message).toContain("AI isn't set up on this server.");
  });

  it.each([
    ["rate_limited", { code: "rate_limited", status: 429 }],
    ["timeout", { code: "unverified_statement", status: 422, message: "The AI reader couldn't be reached. Try again in a few minutes." }],
    ["provider_error", { code: "unverified_statement", status: 422, message: "The AI reader couldn't be reached. Try again in a few minutes." }],
  ] as const)("says so when the provider answers %s", async (reason, expected) => {
    provider.willFail(reason, null);

    expect(await refusal(createDraft(userId, columnsPdf(), now, dependencies()))).toMatchObject(expected);
  });

  it("is refused without a call when the statement is too long for one request", async () => {
    // A CSV can be 2 MB, well over the 120,000 tokens of input the feature allows.
    const long = "02/10/2026;CORNER CAFE;4,50\n".repeat(30_000);

    const error = await refusal(
      createDraft(userId, { kind: "csv", bytes: new TextEncoder().encode(`Booking;Narrative text;Value RON\n${long}`) }, now, dependencies()),
    );

    expect(error).toMatchObject({ code: "unrecognised_layout" });
    expect(error.message).toContain("too long for the AI to read in one go");
    expect(provider.requests).toHaveLength(0);
  });
});
