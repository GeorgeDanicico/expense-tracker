import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { IMPORT_UPLOAD_MAX_ATTEMPTS, resetRateLimits } from "@/lib/http/rate-limit";
import { IMPORT_CSV_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/imports/types";
import { MODULE_KEYS, type ModuleKey, type Permissions } from "@/lib/permissions";
import { aKid, aParent, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { DELETE as DISCARD, GET as GET_ONE } from "@/app/api/imports/[id]/route";
import { POST as CONFIRM } from "@/app/api/imports/[id]/confirm/route";
import { POST as UNDO } from "@/app/api/imports/[id]/undo/route";
import { GET as LIST, POST as UPLOAD } from "@/app/api/imports/route";

const OTHER_USER_ID = "10000000-0000-4000-8000-000000000002";
const MISSING_ID = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";
const NOT_FOUND = "That import wasn't found or has expired.";

const csv = (...lines: string[]) => `Date,Description,Amount,Currency\n${lines.join("\n")}\n`;

/** Two payments in euros (one an OMV fuel stop), one in lei, and a salary that is skipped. */
const STATEMENT = csv(
  "2026-10-12,Lidl,-45.20,EUR",
  "2026-10-13,OMV 1642 Satu Mare,-300.00,EUR",
  "2026-10-14,Foreign shop,-15.00,RON",
  "2026-10-15,Salary,2500.00,EUR",
);

type UploadOptions = {
  /** The `Content-Type` header; `null` sends none. */
  type?: string | null;
  url?: string;
  headers?: Record<string, string>;
};

/** Calls `POST /api/imports` with a raw body, as the browser does; `callRoute` only sends JSON. */
async function upload(body: BodyInit, { type = "text/csv", url = "/api/imports", headers = {} }: UploadOptions = {}) {
  const request = new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    headers: { ...(type === null ? {} : { "content-type": type }), ...headers },
    body,
    duplex: "half",
  });
  const response = await UPLOAD(request, { params: Promise.resolve({}) });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, headers: response.headers, body: isJson ? await response.json() : null };
}

const get = (id: string) => callRoute(GET_ONE, { url: `/api/imports/${id}`, params: { id } });
const discard = (id: string) => callRoute(DISCARD, { method: "DELETE", url: `/api/imports/${id}`, params: { id } });
const confirm = (id: string, body: unknown) =>
  callRoute(CONFIRM, { method: "POST", url: `/api/imports/${id}/confirm`, params: { id }, body });
const undo = (id: string) => callRoute(UNDO, { method: "POST", url: `/api/imports/${id}/undo`, params: { id } });

let repositories: FakeRepositories;

beforeEach(() => {
  repositories = resetFakeRepositories();
  resetRateLimits();
  forgetLastActive();
  signedInAs();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type DraftRowBody = { id: string; description: string; amount: number; expenseDate: string; currency: string; importable: boolean };

/** Uploads the statement and returns the draft's batch id and its rows by description. */
async function uploadedDraft(statement = STATEMENT) {
  const response = await upload(statement);
  expect(response.status).toBe(201);
  const id = response.body.batch.id as string;
  const draft = await get(id);
  const rows = Object.fromEntries((draft.body.rows as DraftRowBody[]).map((row) => [row.description, row]));
  return { id, rows };
}

/** The values the review screen sends back for a row, each as the draft suggests unless overridden. */
const tick = (row: DraftRowBody, overrides: Record<string, unknown> = {}) => ({
  id: row.id,
  description: row.description,
  amount: row.amount,
  expenseDate: row.expenseDate,
  category: "other",
  subtype: null,
  notes: null,
  ...overrides,
});

/** A draft or an import that belongs to another user, seeded without disturbing the caller. */
function seedForSomeoneElse(overrides: Parameters<FakeRepositories["imports"]["seed"]>[0] = {}) {
  const { imports } = repositories;
  imports.callerId = OTHER_USER_ID;
  const batch = imports.seed(overrides, [{ description: "Lidl", amount: 10 }]);
  imports.callerId = testUser.id;
  return batch;
}

describe("POST /api/imports", () => {
  it("saves a draft for the caller and answers 201 with the batch, reopened false and the warnings", async () => {
    const response = await upload(STATEMENT);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.body).toEqual({
      batch: expect.objectContaining({
        status: "draft",
        sourceKind: "csv",
        parserId: "generic-csv",
        rowCount: 3,
        skippedCredits: 1,
        confirmedAt: null,
      }),
      reopened: false,
      warnings: [],
    });
    expect(repositories.imports.batches).toHaveLength(1);
    expect(repositories.imports.batches[0].userId).toBe(testUser.id);
    expect(repositories.imports.rowsOf(response.body.batch.id).map((row) => row.description)).toEqual([
      "Lidl",
      "OMV 1642 Satu Mare",
      "Foreign shop",
    ]);
  });

  it("does not leak the owner or the hash of the batch", async () => {
    const { body } = await upload(STATEMENT);

    expect(body.batch).not.toHaveProperty("userId");
    expect(body.batch).not.toHaveProperty("contentHash");
  });

  it("ignores ?member= and a user id in the headers: imports are the caller's own", async () => {
    const response = await upload(STATEMENT, { url: `/api/imports?member=${OTHER_USER_ID}`, headers: { "x-user-id": OTHER_USER_ID } });

    expect(response.status).toBe(201);
    expect(repositories.imports.batches.map((batch) => batch.userId)).toEqual([testUser.id]);
  });

  it("accepts a content type with parameters, in any case", async () => {
    const response = await upload(STATEMENT, { type: "Text/CSV; charset=utf-8" });

    expect(response.status).toBe(201);
  });

  it("answers 200 with reopened true, the same batch and nothing new saved, for the same statement", async () => {
    const first = await upload(STATEMENT);

    const second = await upload(STATEMENT);

    expect(second.status).toBe(200);
    expect(second.body).toEqual({ batch: first.body.batch, reopened: true, warnings: [] });
    expect(repositories.imports.batches).toHaveLength(1);
  });

  it("lets another user import the same statement", async () => {
    await upload(STATEMENT);
    repositories.imports.callerId = OTHER_USER_ID;
    signedInAs({ id: OTHER_USER_ID, email: "other@example.test" });

    const response = await upload(STATEMENT);

    expect(response.status).toBe(201);
    expect(repositories.imports.batches).toHaveLength(2);
  });

  it("refuses a statement that was confirmed already with 409 and its code, and takes it again after an undo", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl)] });

    const again = await upload(STATEMENT);

    expect(again.status).toBe(409);
    expect(again.body).toEqual({
      error: expect.stringMatching(/^You imported this statement on \d+ \w+(?: \d{4})?\. Undo that import to import it again\.$/),
      code: "already_imported",
    });
    expect(again.body).not.toHaveProperty("fieldErrors");
    expect(repositories.imports.batches).toHaveLength(1);

    expect((await undo(id)).status).toBe(200);
    const third = await upload(STATEMENT);
    expect(third.status).toBe(201);
    expect(third.body.batch.id).not.toBe(id);
  });

  describe("refusals", () => {
    it.each([
      ["no content type", csv("2026-10-12,Lidl,-45.20,EUR"), null],
      ["a plain text body", csv("2026-10-12,Lidl,-45.20,EUR"), "text/plain"],
      ["a multipart body", csv("2026-10-12,Lidl,-45.20,EUR"), "multipart/form-data; boundary=x"],
      ["a JSON body", "{}", "application/json"],
    ])("answers 415 unsupported_type for %s", async (_name, body, type) => {
      const response = await upload(body, { type });

      expect(response.status).toBe(415);
      expect(response.body).toEqual({ error: "Upload a CSV statement.", code: "unsupported_type" });
      expect(repositories.imports.batches).toEqual([]);
    });

    it("answers 415 for a PNG sent as text/csv: the content decides, not the header", async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

      const response = await upload(png);

      expect(response).toMatchObject({ status: 415, body: { code: "unsupported_type" } });
    });

    it("answers 415 for a zip (an xlsx) sent as text/csv", async () => {
      const response = await upload(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]));

      expect(response).toMatchObject({ status: 415, body: { code: "unsupported_type" } });
    });

    it("answers 415 pdf_not_supported for a PDF, however it was declared, until PDFs are turned on", async () => {
      const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

      for (const type of ["application/pdf", "text/csv"]) {
        const response = await upload(pdf, { type });

        expect(response).toMatchObject({ status: 415, body: { error: "PDF statements aren't supported yet.", code: "pdf_not_supported" } });
      }
      expect(repositories.imports.batches).toEqual([]);
    });

    it("answers 415 for a body declared as a PDF that isn't one", async () => {
      const response = await upload(STATEMENT, { type: "application/pdf" });

      expect(response).toMatchObject({ status: 415, body: { error: "That file isn't a PDF statement.", code: "unsupported_type" } });
    });

    it("answers 413 file_too_large for a body over 2 MB with a Content-Length", async () => {
      const response = await upload(new Uint8Array(IMPORT_CSV_MAX_BYTES + 1).fill(0x61), {
        headers: { "content-length": String(IMPORT_CSV_MAX_BYTES + 1) },
      });

      expect(response).toMatchObject({ status: 413, body: { error: "Choose a statement under 2 MB.", code: "file_too_large" } });
    });

    it("answers 413 for a body over 2 MB that is counted as it is read", async () => {
      const chunk = new Uint8Array(64 * 1024).fill(0x61);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent > IMPORT_CSV_MAX_BYTES) return controller.close();
          sent += chunk.length;
          controller.enqueue(chunk);
        },
      });

      const response = await upload(stream);

      expect(response).toMatchObject({ status: 413, body: { code: "file_too_large" } });
    });

    it("answers 422 empty_file for an empty body", async () => {
      const response = await upload(new Uint8Array());

      expect(response).toMatchObject({ status: 422, body: { error: "That file is empty.", code: "empty_file" } });
    });

    it("answers 422 unrecognised_layout for a layout no parser reads, without its text", async () => {
      const response = await upload("Name,Colour\nSecretName,brown\n");

      expect(response).toMatchObject({ status: 422, body: { error: "This statement's layout isn't supported yet.", code: "unrecognised_layout" } });
      expect(JSON.stringify(response.body)).not.toContain("SecretName");
    });

    it("answers 422 no_debits for a statement with only incoming payments", async () => {
      const response = await upload(csv("2026-10-15,Salary,2500.00,EUR"));

      expect(response).toMatchObject({ status: 422, body: { code: "no_debits" } });
      expect(repositories.imports.batches).toEqual([]);
    });

    it("answers 422 too_many_rows for 501 payments", async () => {
      const lines = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, index) => `2026-10-12,Shop ${index},-1.${String(index % 100).padStart(2, "0")},EUR`);

      const response = await upload(csv(...lines));

      expect(response).toMatchObject({ status: 422, body: { code: "too_many_rows" } });
      expect(repositories.imports.batches).toEqual([]);
    });

    it("answers 500 with the route's message, and nothing from the file, for an unexpected failure", async () => {
      vi.spyOn(repositories.imports, "createBatch").mockRejectedValue(new Error("Lidl 45.20 private failure"));

      const response = await upload(STATEMENT);

      expect(response).toMatchObject({ status: 500, body: { error: "Unable to read the statement. Please try again." } });
    });
  });

  describe("rate limit", () => {
    it("answers 429 rate_limited from the 31st attempt in an hour, whatever the earlier ones were", async () => {
      for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
        expect((await upload("not a statement", { type: "text/plain" })).status).toBe(415);
      }

      const response = await upload(STATEMENT);

      expect(response.status).toBe(429);
      expect(response.body).toEqual({ error: "You've uploaded a lot of statements recently. Try again in an hour.", code: "rate_limited" });
      expect(repositories.imports.batches).toEqual([]);
    });

    it("counts per user, and forgets an attempt after an hour", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) await upload("x", { type: "text/plain" });
      expect((await upload(STATEMENT)).status).toBe(429);

      signedInAs({ id: OTHER_USER_ID, email: "other@example.test" });
      repositories.imports.callerId = OTHER_USER_ID;
      expect((await upload(STATEMENT)).status).toBe(201);

      signedInAs();
      repositories.imports.callerId = testUser.id;
      vi.setSystemTime(Date.now() + 61 * 60_000);
      expect((await upload(STATEMENT)).status).toBe(201);
    });
  });
});

describe("GET /api/imports", () => {
  it("lists the caller's recent imports, newest first, with their counts", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl), tick(rows["OMV 1642 Satu Mare"])] });
    repositories.imports.now = () => new Date(Date.now() + 60_000);
    const second = await upload(csv("2026-10-20,Kaufland,-12.00,EUR"));

    const response = await callRoute(LIST, { url: "/api/imports" });

    expect(response.status).toBe(200);
    expect(response.body.imports.map((item: { batch: { id: string } }) => item.batch.id)).toEqual([second.body.batch.id, id]);
    expect(response.body.imports).toEqual([
      { batch: expect.objectContaining({ status: "draft" }), expenseCount: 0, changedCount: 0 },
      { batch: expect.objectContaining({ status: "confirmed", confirmedCount: 2 }), expenseCount: 2, changedCount: 0 },
    ]);
  });

  it("leaves out another user's imports and an expired draft", async () => {
    seedForSomeoneElse();
    repositories.imports.seed({ expiresAt: "2026-10-01T00:00:00.000Z", createdAt: "2026-09-30T00:00:00.000Z" }, [{}]);

    const response = await callRoute(LIST, { url: `/api/imports?member=${OTHER_USER_ID}` });

    expect(response).toMatchObject({ status: 200, body: { imports: [] } });
  });

  it("reports a storage failure with the route's own message", async () => {
    vi.spyOn(repositories.imports, "listRecent").mockRejectedValue(new Error("private failure"));

    const response = await callRoute(LIST, { url: "/api/imports" });

    expect(response).toMatchObject({ status: 500, body: { error: "Unable to load your imports." } });
  });
});

describe("GET /api/imports/[id]", () => {
  it("returns a draft with its rows, suggestions and whether each can be imported", async () => {
    const { id } = await uploadedDraft();

    const response = await get(id);

    expect(response.status).toBe(200);
    expect(response.body.batch).toMatchObject({ id, status: "draft", rowCount: 3 });
    expect(response.body.rows.map((row: Record<string, unknown>) => [row.description, row.category, row.subtype, row.ruleMatched, row.importable, row.duplicateOf]))
      .toEqual([
        ["Lidl", "other", null, false, true, null],
        ["OMV 1642 Satu Mare", "car", "car_fuel", true, true, null],
        ["Foreign shop", "other", null, false, false, null],
      ]);
  });

  it("flags a row that looks like one of the caller's expenses, and not one of another user's", async () => {
    const { id } = await uploadedDraft();
    repositories.expenses.expenses.set(testUser.id, [anExpense({ id: "mine", description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" })]);
    repositories.expenses.expenses.set(OTHER_USER_ID, [anExpense({ id: "theirs", description: "OMV 1642", amount: 300, expenseDate: "2026-10-13" })]);

    const response = await get(id);

    const flags = Object.fromEntries(response.body.rows.map((row: { description: string; duplicateOf: unknown }) => [row.description, row.duplicateOf]));
    expect(flags.Lidl).toEqual({ id: "mine", description: "Lidl", expenseDate: "2026-10-12", amount: 45.2 });
    expect(flags["OMV 1642 Satu Mare"]).toBeNull();
  });

  it("returns only the summary of a confirmed or an undone import", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl)] });

    const confirmed = await get(id);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toEqual({ batch: expect.objectContaining({ id, status: "confirmed", confirmedCount: 1 }) });

    await undo(id);
    const undone = await get(id);
    expect(undone.body).toEqual({ batch: expect.objectContaining({ id, status: "undone" }) });
  });

  it("answers 404 for an unknown import, another user's, and a draft that has expired", async () => {
    const theirs = seedForSomeoneElse();
    const { id } = await uploadedDraft();
    repositories.imports.now = () => new Date(Date.now() + 25 * 60 * 60_000);

    for (const missing of [MISSING_ID, theirs.id, id]) {
      expect(await get(missing)).toMatchObject({ status: 404, body: { error: NOT_FOUND } });
    }
  });

  it("answers 400 for an identifier that isn't a UUID, without reading the repository", async () => {
    const read = vi.spyOn(repositories.imports, "getBatch");

    expect(await get("nope")).toMatchObject({ status: 400, body: { error: "Invalid import identifier." } });
    expect(read).not.toHaveBeenCalled();
  });
});

describe("POST /api/imports/[id]/confirm", () => {
  it("saves the ticked rows as the caller's expenses and answers the expenses as stored", async () => {
    const { id, rows } = await uploadedDraft();

    // The OMV row is sent as `other`; the merchant classification makes it a fuel stop, as for any insert.
    const response = await confirm(id, {
      rows: [tick(rows.Lidl, { description: "Lidl Satu Mare", category: "groceries", amount: 44.9 }), tick(rows["OMV 1642 Satu Mare"])],
    });

    expect(response.status).toBe(200);
    expect(response.body.batch).toMatchObject({ id, status: "confirmed", confirmedCount: 2, expiresAt: null });
    expect(response.body.created).toEqual([
      expect.objectContaining({ description: "Lidl Satu Mare", amount: 44.9, category: "groceries", expenseDate: "2026-10-12" }),
      expect.objectContaining({ description: "OMV 1642 Satu Mare", amount: 300, category: "car", subtype: "car_fuel", expenseDate: "2026-10-13" }),
    ]);
    expect(repositories.expenses.expenses.get(testUser.id)).toHaveLength(2);
    expect(repositories.expenses.expenses.get(OTHER_USER_ID)).toBeUndefined();
    expect(repositories.imports.links.map((link) => link.batchId)).toEqual([id, id]);
    expect(repositories.imports.rowsOf(id)).toEqual([]);
  });

  it("leaves unticked rows out", async () => {
    const { id, rows } = await uploadedDraft();

    await confirm(id, { rows: [tick(rows.Lidl)] });

    expect(repositories.expenses.expenses.get(testUser.id)?.map((expense) => expense.description)).toEqual(["Lidl"]);
  });

  it("does not block a row that looks like an existing expense: ticking it is the caller's call", async () => {
    const { id, rows } = await uploadedDraft();
    repositories.expenses.expenses.set(testUser.id, [anExpense({ id: "mine", description: "Lidl", amount: 45.2, expenseDate: "2026-10-12" })]);

    const response = await confirm(id, { rows: [tick(rows.Lidl)] });

    expect(response.status).toBe(200);
    expect(repositories.expenses.expenses.get(testUser.id)).toHaveLength(2);
  });

  it("answers 422 with field errors for the bad row, and saves nothing", async () => {
    const { id, rows } = await uploadedDraft();
    const createBatchRows = vi.spyOn(repositories.imports, "confirm");

    const response = await confirm(id, {
      rows: [tick(rows.Lidl), tick(rows["OMV 1642 Satu Mare"], { amount: 0, description: "" })],
    });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("Check the rows and try again.");
    expect(Object.keys(response.body.fieldErrors).toSorted()).toEqual(["rows.1.amount", "rows.1.description"]);
    expect(createBatchRows).not.toHaveBeenCalled();
    expect(repositories.expenses.expenses.get(testUser.id) ?? []).toEqual([]);
    expect((await get(id)).body.batch.status).toBe("draft");
  });

  it("answers 422 for a subtype that doesn't belong to the category", async () => {
    const { id, rows } = await uploadedDraft();

    const response = await confirm(id, { rows: [tick(rows.Lidl, { category: "groceries", subtype: "car_fuel" })] });

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors).toHaveProperty(["rows.0.subtype"]);
  });

  it("answers 422 for a row that isn't part of this import, and for one in another currency", async () => {
    const { id, rows } = await uploadedDraft();

    const stranger = await confirm(id, { rows: [tick(rows.Lidl, { id: MISSING_ID })] });
    expect(stranger).toMatchObject({ status: 422, body: { fieldErrors: { "rows.0.id": ["That row isn't part of this import."] } } });

    const foreign = await confirm(id, { rows: [tick(rows["Foreign shop"])] });
    expect(foreign).toMatchObject({ status: 422, body: { fieldErrors: { "rows.0.id": [expect.stringContaining("RON")] } } });

    expect(repositories.expenses.expenses.get(testUser.id) ?? []).toEqual([]);
    expect((await get(id)).body.batch.status).toBe("draft");
  });

  it.each([
    ["an empty list of rows", { rows: [] }],
    ["no rows", {}],
    ["a body that isn't JSON", "not json"],
    ["a JSON null", "null"],
  ])("answers 422 for %s", async (_name, body) => {
    const { id } = await uploadedDraft();

    const response = await confirm(id, body);

    expect(response).toMatchObject({ status: 422, body: { error: "Check the rows and try again." } });
  });

  it("answers 409 when the draft was confirmed already, and adds nothing the second time", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl)] });

    const response = await confirm(id, { rows: [tick(rows.Lidl)] });

    expect(response).toMatchObject({ status: 409, body: { error: "That import was already confirmed or undone." } });
    expect(repositories.expenses.expenses.get(testUser.id)).toHaveLength(1);
  });

  it("answers 404 for an unknown import, another user's and an expired draft", async () => {
    const theirs = seedForSomeoneElse();
    const { id, rows } = await uploadedDraft();
    const body = { rows: [tick(rows.Lidl)] };
    repositories.imports.now = () => new Date(Date.now() + 25 * 60 * 60_000);

    for (const missing of [MISSING_ID, theirs.id, id]) {
      expect(await confirm(missing, body)).toMatchObject({ status: 404, body: { error: NOT_FOUND } });
    }
    expect(repositories.expenses.expenses.get(testUser.id) ?? []).toEqual([]);
  });

  it("answers 400 for an identifier that isn't a UUID", async () => {
    expect(await confirm("nope", { rows: [] })).toMatchObject({ status: 400, body: { error: "Invalid import identifier." } });
  });
});

describe("POST /api/imports/[id]/undo", () => {
  it("removes the expenses the import created, and only those, and answers the batch and the count", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl), tick(rows["OMV 1642 Satu Mare"])] });
    const mine = repositories.expenses.expenses.get(testUser.id)!;
    mine.push(anExpense({ id: "by-hand", description: "Coffee", expenseDate: "2026-10-16" }));

    const response = await undo(id);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ batch: expect.objectContaining({ id, status: "undone", undoneAt: expect.any(String) }), removed: 2 });
    expect(repositories.expenses.expenses.get(testUser.id)?.map((expense) => expense.id)).toEqual(["by-hand"]);
  });

  it("answers 409 for a draft and for an import that was undone already", async () => {
    const { id, rows } = await uploadedDraft();
    expect(await undo(id)).toMatchObject({ status: 409, body: { error: "Only a confirmed import can be undone." } });

    await confirm(id, { rows: [tick(rows.Lidl)] });
    await undo(id);
    expect(await undo(id)).toMatchObject({ status: 409 });
    expect(repositories.imports.batches[0].status).toBe("undone");
  });

  it("answers 409 for an import older than the caller's newest twenty", async () => {
    const old = repositories.imports.seed({ status: "confirmed", createdAt: "2026-01-01T00:00:00.000Z" }, [{}]);
    for (let index = 0; index < 20; index += 1) {
      repositories.imports.seed({ status: "undone", createdAt: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z` }, [{}]);
    }

    expect(await undo(old.id)).toMatchObject({ status: 409, body: { error: "That import is too old to undo." } });
  });

  it("answers 404 for an unknown import, another user's, and an expired draft", async () => {
    const theirs = seedForSomeoneElse({ status: "confirmed" });
    const expired = repositories.imports.seed({ createdAt: "2026-09-01T00:00:00.000Z" }, [{}]);

    for (const missing of [MISSING_ID, theirs.id, expired.id]) {
      expect(await undo(missing)).toMatchObject({ status: 404, body: { error: NOT_FOUND } });
    }
    expect(repositories.imports.batches.find((batch) => batch.id === theirs.id)?.status).toBe("confirmed");
  });

  it("answers 400 for an identifier that isn't a UUID", async () => {
    expect(await undo("nope")).toMatchObject({ status: 400, body: { error: "Invalid import identifier." } });
  });
});

describe("DELETE /api/imports/[id]", () => {
  it("discards a draft with its rows and answers 204", async () => {
    const { id } = await uploadedDraft();

    const response = await discard(id);

    expect(response).toMatchObject({ status: 204, body: null });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(repositories.imports.batches).toEqual([]);
    expect(repositories.imports.rows).toEqual([]);
    expect((await get(id)).status).toBe(404);
  });

  it("lets the same statement be uploaded again after a discard", async () => {
    const { id } = await uploadedDraft();
    await discard(id);

    expect((await upload(STATEMENT)).status).toBe(201);
  });

  it("answers 409 for a confirmed or undone import, and keeps it", async () => {
    const { id, rows } = await uploadedDraft();
    await confirm(id, { rows: [tick(rows.Lidl)] });
    expect(await discard(id)).toMatchObject({ status: 409, body: { error: "That import was already confirmed or undone." } });

    await undo(id);
    expect(await discard(id)).toMatchObject({ status: 409 });
    expect(repositories.imports.batches).toHaveLength(1);
  });

  it("answers 404 for an unknown import and another user's, which stays", async () => {
    const theirs = seedForSomeoneElse();

    for (const missing of [MISSING_ID, theirs.id]) {
      expect(await discard(missing)).toMatchObject({ status: 404, body: { error: NOT_FOUND } });
    }
    expect(repositories.imports.batches.map((batch) => batch.id)).toEqual([theirs.id]);
  });

  it("answers 400 for an identifier that isn't a UUID", async () => {
    expect(await discard("nope")).toMatchObject({ status: 400, body: { error: "Invalid import identifier." } });
  });
});

describe("imports in a family", () => {
  const permissions = (expenses: Permissions["expenses"]): Permissions =>
    Object.fromEntries(MODULE_KEYS.map((key: ModuleKey) => [key, key === "expenses" ? expenses : "off"])) as Permissions;

  beforeEach(() => vi.stubEnv("FAMILY_ENABLED", "true"));

  /** Runs every action once: upload, list, read, confirm, undo and discard, each on its own import. */
  async function everyAction() {
    const { id, rows } = await uploadedDraft();
    const second = await upload(csv("2026-10-20,Kaufland,-12.00,EUR"));
    const confirmed = await confirm(id, { rows: [tick(rows.Lidl)] });
    return {
      upload: await upload(csv("2026-10-21,Penny,-8.00,EUR")),
      list: await callRoute(LIST, { url: "/api/imports" }),
      read: await get(second.body.batch.id),
      confirm: confirmed,
      undo: await undo(id),
      discard: await discard(second.body.batch.id),
    };
  }

  it.each([
    ["a parent", () => aParent()],
    ["a kid with Expenses on", () => aKid({ permissions: permissions("edit") })],
    ["a user without a family", () => null],
  ])("lets %s upload, list, read, confirm, undo and discard", async (_name, membership) => {
    repositories.family.membership = membership();

    const results = await everyAction();

    expect(Object.fromEntries(Object.entries(results).map(([action, { status }]) => [action, status]))).toEqual({
      upload: 201,
      list: 200,
      read: 200,
      confirm: 200,
      undo: 200,
      discard: 204,
    });
  });

  it("gives a parent only their own imports, not a kid's, whatever Family finance says", async () => {
    repositories.family.membership = aParent();
    const kids = seedForSomeoneElse({ status: "confirmed" });

    expect(await callRoute(LIST, { url: `/api/imports?member=${OTHER_USER_ID}` })).toMatchObject({ body: { imports: [] } });
    expect(await get(kids.id)).toMatchObject({ status: 404 });
    expect(await undo(kids.id)).toMatchObject({ status: 404 });
  });

  it("answers 403 on all six, and never touches the import repository, for a kid with Expenses off", async () => {
    const batch = repositories.imports.seed({}, [{ description: "Lidl" }]);
    repositories.family.membership = aKid({ permissions: permissions("off") });
    const touched = (["createBatch", "findLiveByHash", "getDraft", "getBatch", "listRecent", "confirm", "undo", "discard"] as const)
      .map((method) => vi.spyOn(repositories.imports, method));
    const content = vi.spyOn(repositories.expenses, "listRange");

    const results = [
      await upload(STATEMENT),
      await callRoute(LIST, { url: "/api/imports" }),
      await get(batch.id),
      await confirm(batch.id, { rows: [] }),
      await undo(batch.id),
      await discard(batch.id),
    ];

    for (const result of results) {
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ error: "You don't have access to this." });
    }
    for (const spy of touched) expect(spy).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    expect(repositories.imports.batches).toHaveLength(1);
  });

  it("refuses the upload before it counts an attempt or reads the body", async () => {
    repositories.family.membership = aKid({ permissions: permissions("off") });
    for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS + 1; attempt += 1) await upload(STATEMENT);

    repositories.family.membership = aKid({ permissions: permissions("edit") });

    expect((await upload(STATEMENT)).status).toBe(201);
  });
});
