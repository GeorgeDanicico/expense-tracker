import type { ConfirmRows, ImportApi } from "@/components/expenses/import/import-api";
import { ApiError } from "@/lib/api/client";
import { addDays, getBucharestToday } from "@/lib/calendar";
import { subtypeForCategory, type ExpenseSubtype } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import type { ImportsResponse } from "@/lib/api/keys";
import { decodeStatementText } from "@/lib/imports/decode";
import { flagDuplicates } from "@/lib/imports/duplicates";
import { parseStatement } from "@/lib/imports/parser";
import { maskAccountNumbers } from "@/lib/imports/redact";
import type { RecentImport } from "@/lib/imports/repository";
import {
  ImportError,
  type DraftRow,
  type ImportBatch,
  type ImportDraft,
} from "@/lib/imports/types";
import { confirmImportSchema } from "@/lib/validation/import";

// The statement import for `/dev/preview/import`: a fake API that keeps drafts and the expenses an
// import creates in memory, so uploading, ticking, editing, confirming and undoing work without a
// session or a database. It runs the real pieces that are pure code: the generic CSV parser and
// the masking (`buildDraft` itself hashes with `node:crypto`, which a browser bundle can't import,
// so the preview keeps its own simple hash), `flagDuplicates` (against the sample expenses below) and
// `confirmImportSchema`, so a file that parses on the server parses here, and a bad row is refused
// with the same field errors. The merchant rule is a stand-in for the database's. `?failWrites=1`
// refuses every confirm, discard and undo, to show the error states. The sample statement below
// matches the sample expenses (three of its rows are possible duplicates), has a row in RON
// (the preview account is in EUR), a fuel station the merchant rule knows, and four incoming
// payments; the preview page offers it as a download.
//
// The list of recent imports starts with a few made-up ones (a draft with 19 hours left that can be
// resumed, two confirmed imports, one of which has 2 expenses "edited since", and an undone one), so
// resume, discard and undo can be tried without uploading anything first. Their expenses aren't in
// the sample expenses below: undoing one reports its count and changes nothing. `?draft=<id>` opens
// a draft directly; an id the preview doesn't know is a 404, which is what an expired draft is.

/** The preview account's currency (see `fixtures.ts`). */
const ACCOUNT_CURRENCY = "EUR";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SampleRow = [daysAgo: number, description: string, amount: number, currency: string];

const SAMPLE_ROWS: SampleRow[] = [
  [1, "Lidl Cluj Napoca 1234", -45.2, ACCOUNT_CURRENCY],
  [2, "OMV 1642 Satu Mare", -61.2, ACCOUNT_CURRENCY],
  [2, "Netflix.com", -12.99, ACCOUNT_CURRENCY],
  [3, "Kaufland Marasti", -86.4, ACCOUNT_CURRENCY],
  [4, "Farmacia Dona", -18.9, ACCOUNT_CURRENCY],
  [5, "Salary October", 2500, ACCOUNT_CURRENCY],
  [5, "Refund Zalando", 34.99, ACCOUNT_CURRENCY],
  [6, "Cinema City Polus", -24, ACCOUNT_CURRENCY],
  [7, "Bolt ride", -7.8, ACCOUNT_CURRENCY],
  [8, "Starbucks Unirii", -5.4, ACCOUNT_CURRENCY],
  [9, "Transfer from savings", 300, ACCOUNT_CURRENCY],
  [10, "Booking.com hotel two nights", -312.6, ACCOUNT_CURRENCY],
  [11, "Zara Store Bucuresti", -399, "RON"],
  [12, "Digi internet", -29.99, ACCOUNT_CURRENCY],
  [13, "Interest paid", 1.12, ACCOUNT_CURRENCY],
  [14, "Online course Udemy", -39, ACCOUNT_CURRENCY],
  [15, "Salary reversal", 15, ACCOUNT_CURRENCY],
];

/** The sample statement as CSV text, dated back from today so it always looks recent. */
export function previewSampleStatement(today = getBucharestToday()): string {
  const lines = SAMPLE_ROWS.map(([daysAgo, description, amount, currency]) =>
    `${addDays(today, -daysAgo)},${description},${amount.toFixed(2)},${currency}`);
  return ["Date,Description,Amount,Currency", ...lines].join("\n");
}

/** The expenses already saved, which the sample statement's duplicates match. */
function seedExpenses(today = getBucharestToday()): Expense[] {
  const expense = (id: string, daysAgo: number, description: string, amount: number, category: Expense["category"]): Expense => ({
    id, description, amount, category, subtype: null, expenseDate: addDays(today, -daysAgo), notes: null,
  });
  return [
    expense("saved-1", 1, "Lidl", 45.2, "groceries"),
    expense("saved-2", 3, "Kaufland", 86.4, "groceries"),
    expense("saved-3", 4, "Farmacia Dona", 18.9, "health"),
    expense("saved-4", 20, "Rent", 950, "housing"),
  ];
}

/** A stand-in for the merchant rule the database applies: fuel stations are car fuel. */
function merchantRule(description: string): ExpenseSubtype | null {
  return /\b(omv|petrom|mol|rompetrol)\b/i.test(description) ? "car_fuel" : null;
}

type StoredRow = Omit<DraftRow, "duplicateOf" | "importable">;
type StoredImport = {
  batch: ImportBatch;
  rows: StoredRow[];
  hash: string;
  created: string[];
  /** A made-up import from the start: its expenses aren't in `expenses()`, only counted. */
  seeded?: { expenseCount: number; changedCount: number };
};

let store: Map<string, StoredImport> | null = null;
let saved: Expense[] | null = null;

/** The id of the draft the list starts with. */
export const PREVIEW_DRAFT_ID = "preview-draft";

const SEED_DRAFT_ROWS: SampleRow[] = [
  [22, "Mega Image Brasov 0412", -32.15, ACCOUNT_CURRENCY],
  [21, "Petrom Floresti", -58, ACCOUNT_CURRENCY],
  [20, "Rent", -950, ACCOUNT_CURRENCY],
  [19, "Spotify", -9.99, ACCOUNT_CURRENCY],
  [18, "Decathlon Cluj", -129.9, ACCOUNT_CURRENCY],
  [17, "Hotel Zagreb", -420, "RON"],
  [16, "Salary", 2500, ACCOUNT_CURRENCY],
  [15, "Pharmacy Catena", -23.4, ACCOUNT_CURRENCY],
];

const DAY = 86_400_000;

function seededBatch(overrides: Partial<ImportBatch> & Pick<ImportBatch, "id" | "status" | "createdAt">): ImportBatch {
  return {
    sourceKind: "csv",
    parserId: "generic-csv",
    currency: ACCOUNT_CURRENCY,
    periodStart: null,
    periodEnd: null,
    rowCount: 1,
    skippedCredits: 0,
    expiresAt: null,
    confirmedAt: null,
    confirmedCount: null,
    undoneAt: null,
    ...overrides,
  };
}

/** The made-up recent imports, dated back from now so they always look recent. */
function seedImports(now = Date.now(), today = getBucharestToday()): Map<string, StoredImport> {
  const map = new Map<string, StoredImport>();

  const text = SEED_DRAFT_ROWS.map(([daysAgo, description, amount, currency]) =>
    `${addDays(today, -daysAgo)},${description},${amount.toFixed(2)},${currency}`);
  const draft = previewDraft(new TextEncoder().encode(["Date,Description,Amount,Currency", ...text].join("\n")));
  // A minute over five hours, so the list reads "expires in 19 h" however soon it is looked at.
  const created = now - (5 * 60 + 1) * 60_000;
  map.set(PREVIEW_DRAFT_ID, {
    batch: seededBatch({
      id: PREVIEW_DRAFT_ID,
      status: "draft",
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + 24 * 3_600_000).toISOString(),
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      rowCount: draft.rows.length,
      skippedCredits: draft.skippedCredits,
    }),
    rows: draftRows(draft.rows),
    hash: draft.hash,
    created: [],
  });

  const month = (id: string, daysAgo: number, count: number, changed: number, status: "confirmed" | "undone") => {
    const at = new Date(now - daysAgo * DAY).toISOString();
    map.set(id, {
      batch: seededBatch({
        id,
        status,
        createdAt: at,
        confirmedAt: at,
        confirmedCount: count,
        rowCount: count,
        periodStart: addDays(today, -daysAgo - 31),
        periodEnd: addDays(today, -daysAgo - 1),
        undoneAt: status === "undone" ? new Date(now - (daysAgo - 2) * DAY).toISOString() : null,
      }),
      rows: [],
      hash: id,
      created: [],
      seeded: status === "confirmed" ? { expenseCount: count, changedCount: changed } : undefined,
    });
  };
  month("preview-confirmed-1", 26, 37, 2, "confirmed");
  month("preview-confirmed-2", 58, 24, 0, "confirmed");
  month("preview-undone", 85, 19, 0, "undone");
  return map;
}

/** The imports, made up on first use. */
function imports(): Map<string, StoredImport> {
  store ??= seedImports();
  return store;
}

function expenses(): Expense[] {
  saved ??= seedExpenses();
  return saved;
}

async function refuseWrites() {
  await delay(500);
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("failWrites")) {
    throw new ApiError("The import could not be saved. Try again.", 500);
  }
}

const notFound = () => new ApiError("That import wasn't found or has expired.", 404);

/** The upload's draft, as `buildDraft` makes it without its hash: the debits only, masked, with the credits counted. */
function previewDraft(bytes: Uint8Array) {
  const parsed = parseStatement({ kind: "csv", text: decodeStatementText(bytes) });
  const debits = parsed.rows.filter((row) => row.direction === "debit");
  if (debits.length === 0) throw new ImportError("no_debits");
  const rows = debits.map((row) => ({
    expense_date: row.expenseDate,
    description: maskAccountNumbers(row.description.replace(/\s+/g, " ").trim()).slice(0, 120),
    amount: row.amount,
    currency: row.currency,
    notes: null as string | null,
  }));
  const text = rows.map((row) => `${row.expense_date}|${row.amount}|${row.currency}|${row.description}`).toSorted().join("\n");
  let hash = 0;
  for (const character of text) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) | 0;
  return {
    parserId: parsed.parserId,
    currency: parsed.currency ?? null,
    periodStart: parsed.periodStart ?? rows.map((row) => row.expense_date).toSorted()[0],
    periodEnd: parsed.periodEnd ?? rows.map((row) => row.expense_date).toSorted().at(-1)!,
    skippedCredits: parsed.rows.length - debits.length,
    hash: String(hash),
    rows,
    warnings: parsed.warnings ?? [],
  };
}

/** The stored rows of a draft: the merchant rule's suggestion on each, as `create_import_batch` sets it. */
function draftRows(rows: ReturnType<typeof previewDraft>["rows"]): StoredRow[] {
  return rows.map((row, index) => {
    const subtype = merchantRule(row.description);
    return {
      id: crypto.randomUUID(),
      position: index + 1,
      expenseDate: row.expense_date,
      description: row.description,
      amount: row.amount,
      currency: row.currency,
      category: subtype ? "car" : "other",
      subtype,
      ruleMatched: subtype !== null,
      notes: row.notes ?? null,
    };
  });
}

function importDay(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(new Date(iso));
}

function liveDraft(id: string): StoredImport {
  const stored = imports().get(id);
  if (!stored) throw notFound();
  if (stored.batch.status !== "draft") throw new ApiError("That import was already confirmed or undone.", 409);
  return stored;
}

function draftOf(stored: StoredImport): ImportDraft {
  const importable = stored.rows.filter((row) => row.currency === ACCOUNT_CURRENCY);
  const flags = new Map(
    flagDuplicates(importable, expenses()).map((duplicate, index) => [importable[index].id, duplicate] as const),
  );
  return {
    batch: stored.batch,
    rows: stored.rows.map((row) => ({
      ...row,
      duplicateOf: flags.get(row.id) ?? null,
      importable: row.currency === ACCOUNT_CURRENCY,
    })),
  };
}

function fieldErrorsOf(rows: ConfirmRows, stored: StoredImport) {
  const parsed = confirmImportSchema.safeParse({ rows });
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "rows"] ??= []).push(issue.message);
  }
  rows.forEach((row, index) => {
    const draftRow = stored.rows.find((item) => item.id === row.id);
    if (!draftRow) fieldErrors[`rows.${index}.id`] = ["That row isn't part of this import."];
    else if (draftRow.currency !== ACCOUNT_CURRENCY) {
      fieldErrors[`rows.${index}.id`] = [`That row is in ${draftRow.currency}, not ${ACCOUNT_CURRENCY}, and can't be imported.`];
    }
  });
  return fieldErrors;
}

export const previewImportApi: ImportApi = {
  async upload(file) {
    await delay(700);
    let draft;
    try {
      draft = previewDraft(new Uint8Array(await file.arrayBuffer()));
    } catch (caught) {
      if (caught instanceof ImportError) throw new ApiError(caught.message, caught.status);
      throw caught;
    }

    const same = [...imports().values()].find(
      (stored) => stored.hash === draft.hash && stored.batch.status !== "undone",
    );
    if (same?.batch.status === "draft") return { batch: same.batch, reopened: true, warnings: [] };
    if (same) {
      throw new ApiError(
        `You imported this statement on ${importDay(same.batch.confirmedAt ?? new Date().toISOString())}. Undo that import to import it again.`,
        409,
      );
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const batch: ImportBatch = {
      id,
      status: "draft",
      sourceKind: "csv",
      parserId: draft.parserId,
      currency: draft.currency,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      rowCount: draft.rows.length,
      skippedCredits: draft.skippedCredits,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 24 * 3_600_000).toISOString(),
      confirmedAt: null,
      confirmedCount: null,
      undoneAt: null,
    };
    const rows = draftRows(draft.rows);
    imports().set(id, { batch, rows, hash: draft.hash, created: [] });
    return { batch, reopened: false, warnings: draft.warnings };
  },

  async getDraft(id) {
    await delay(300);
    return draftOf(liveDraft(id));
  },

  async confirm(id, rows) {
    await refuseWrites();
    const stored = liveDraft(id);
    const fieldErrors = fieldErrorsOf(rows, stored);
    if (Object.keys(fieldErrors).length > 0) throw new ApiError("Check the rows and try again.", 422, fieldErrors);

    const created = rows.map((row): Expense => {
      // The database applies the merchant rule on every insert, whatever the screen sent.
      const subtype = merchantRule(row.description) ?? row.subtype;
      const category = subtype ? "car" : row.category;
      return {
        id: crypto.randomUUID(),
        description: row.description,
        amount: row.amount,
        category,
        subtype: subtypeForCategory(category, subtype),
        expenseDate: row.expenseDate,
        notes: row.notes ?? null,
      };
    });
    saved = [...created, ...expenses()];
    const batch: ImportBatch = {
      ...stored.batch,
      status: "confirmed",
      expiresAt: null,
      confirmedAt: new Date().toISOString(),
      confirmedCount: created.length,
    };
    imports().set(id, { ...stored, batch, created: created.map((expense) => expense.id) });
    return { batch, created };
  },

  async discard(id) {
    await refuseWrites();
    liveDraft(id);
    imports().delete(id);
  },

  async undo(id) {
    await refuseWrites();
    const stored = imports().get(id);
    if (!stored) throw notFound();
    if (stored.batch.status !== "confirmed") throw new ApiError("Only a confirmed import can be undone.", 409);
    const removed = stored.seeded?.expenseCount ?? stored.created.length;
    saved = expenses().filter((expense) => !stored.created.includes(expense.id));
    const batch: ImportBatch = { ...stored.batch, status: "undone", undoneAt: new Date().toISOString() };
    imports().set(id, { ...stored, batch, created: [], seeded: undefined });
    return { batch, removed };
  },
};

/**
 * What `GET /api/imports` answers in the preview: live drafts first, then the confirmed and undone
 * imports, newest first, at most 20, each with how many of its expenses still exist.
 */
export function previewRecentImports(now = Date.now()): ImportsResponse {
  const list = [...imports().values()]
    .filter((item) => item.batch.status !== "draft" || new Date(item.batch.expiresAt ?? 0).getTime() > now)
    .map((item): RecentImport => ({
      batch: item.batch,
      expenseCount: item.batch.status === "confirmed" ? item.seeded?.expenseCount ?? item.created.length : 0,
      changedCount: item.batch.status === "confirmed" ? item.seeded?.changedCount ?? 0 : 0,
    }));
  const rank = (item: RecentImport) => (item.batch.status === "draft" ? 0 : 1);
  return {
    imports: list
      .toSorted((a, b) => rank(a) - rank(b) || b.batch.createdAt.localeCompare(a.batch.createdAt))
      .slice(0, 20),
  };
}

/** The expenses the preview has saved (the sample ones plus what imports created), for the tests. */
export function previewExpenses(): readonly Expense[] {
  return expenses();
}
