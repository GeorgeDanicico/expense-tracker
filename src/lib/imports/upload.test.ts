import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMPORT_UPLOAD_MAX_ATTEMPTS,
  IMPORT_UPLOAD_WINDOW_MS,
  TOO_MANY_IMPORT_UPLOADS,
  resetRateLimits,
} from "@/lib/http/rate-limit";
import { recordImportUploadAttempt, readStatementUpload } from "@/lib/imports/upload";
import { IMPORT_CSV_MAX_BYTES, IMPORT_PDF_MAX_BYTES, ImportError } from "@/lib/imports/types";

const URL = "http://localhost/api/imports";
const CSV_TYPE = "text/csv";
const PDF_TYPE = "application/pdf";

const text = (value: string) => new TextEncoder().encode(value);
const CSV = text("Date,Description,Amount\n2026-09-01,Corner Cafe,-4.50\n");
const PDF = text("%PDF-1.7\n1 0 obj\n<< >>\nendobj\n");

function upload(body: Uint8Array | null, headers: Record<string, string> = { "content-type": CSV_TYPE }) {
  return new Request(URL, { method: "POST", headers, body: body as BodyInit | null });
}

/** A body sent in chunks with no `Content-Length`, like a chunked upload. */
function streamed(chunks: Uint8Array[], headers: Record<string, string>) {
  let next = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[next];
      next += 1;
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request(URL, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
}

async function refusal(promise: Promise<unknown>): Promise<ImportError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ImportError);
  return error as ImportError;
}

function withPrefix(prefix: number[], length = 64) {
  const bytes = new Uint8Array(length).fill(0x41);
  bytes.set(prefix);
  return bytes;
}

describe("readStatementUpload: the declared type", () => {
  it("accepts a CSV and ignores the parameters and the case of the type", async () => {
    const result = await readStatementUpload(upload(CSV, { "content-type": "Text/CSV; charset=utf-8" }));

    expect(result.kind).toBe("csv");
    expect(result.bytes).toEqual(CSV);
  });

  it.each(["text/plain", "multipart/form-data; boundary=x", "application/octet-stream", "application/json", "image/png"])(
    "refuses %s with a 415",
    async (type) => {
      const error = await refusal(readStatementUpload(upload(CSV, { "content-type": type })));

      expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
    },
  );

  it("refuses a request with no Content-Type", async () => {
    const error = await refusal(readStatementUpload(new Request(URL, { method: "POST", body: CSV })));

    expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
  });

  it("refuses on the header before reading the body", async () => {
    const request = upload(CSV, { "content-type": "text/plain" });

    await refusal(readStatementUpload(request));

    expect(request.bodyUsed).toBe(false);
  });
});

describe("readStatementUpload: size", () => {
  it("accepts a CSV exactly at 2 MB", async () => {
    const body = new Uint8Array(IMPORT_CSV_MAX_BYTES).fill(0x61);

    const result = await readStatementUpload(upload(body));

    expect(result.bytes.length).toBe(IMPORT_CSV_MAX_BYTES);
  });

  it("refuses a CSV 1 byte over 2 MB by its Content-Length, without reading it", async () => {
    const body = new Uint8Array(IMPORT_CSV_MAX_BYTES + 1).fill(0x61);
    const request = upload(body, { "content-type": CSV_TYPE, "content-length": String(body.length) });

    const error = await refusal(readStatementUpload(request));

    expect(error).toMatchObject({ code: "file_too_large", status: 413, message: "Choose a statement under 2 MB." });
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a CSV 1 byte over 2 MB with no Content-Length, counting while it reads", async () => {
    const half = new Uint8Array(IMPORT_CSV_MAX_BYTES / 2).fill(0x61);
    const request = streamed([half, half, new Uint8Array(1).fill(0x61)], { "content-type": CSV_TYPE });
    expect(request.headers.get("content-length")).toBeNull();

    const error = await refusal(readStatementUpload(request));

    expect(error).toMatchObject({ code: "file_too_large", status: 413, message: "Choose a statement under 2 MB." });
  });

  it("allows up to 5 MB for a PDF and says 5 MB when it's over", async () => {
    const body = new Uint8Array(IMPORT_PDF_MAX_BYTES + 1).fill(0x61);
    body.set(PDF);

    const over = await refusal(
      readStatementUpload(upload(body, { "content-type": PDF_TYPE, "content-length": String(body.length) })),
    );
    expect(over).toMatchObject({ code: "file_too_large", status: 413, message: "Choose a statement under 5 MB." });

    const ok = await readStatementUpload(upload(body.subarray(0, IMPORT_PDF_MAX_BYTES), { "content-type": PDF_TYPE }));
    expect(ok.kind).toBe("pdf");
  });

  it("refuses an empty body, with and without one", async () => {
    for (const body of [new Uint8Array(), null]) {
      const error = await refusal(readStatementUpload(upload(body)));
      expect(error).toMatchObject({ code: "empty_file", status: 422 });
    }
  });
});

describe("readStatementUpload: the signature check", () => {
  it("accepts UTF-8 with a BOM, and a UTF-16 CSV (whose NUL bytes are expected)", async () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...CSV]);
    const utf16le = new Uint8Array([0xff, 0xfe]);
    const utf16 = new Uint8Array(2 + CSV.length * 2);
    utf16.set(utf16le);
    CSV.forEach((byte, index) => {
      utf16[2 + index * 2] = byte;
    });
    const utf16be = new Uint8Array(2 + CSV.length * 2);
    utf16be.set([0xfe, 0xff]);
    CSV.forEach((byte, index) => {
      utf16be[3 + index * 2] = byte;
    });

    for (const body of [utf8, utf16, utf16be]) {
      await expect(readStatementUpload(upload(body))).resolves.toMatchObject({ kind: "csv" });
    }
  });

  it("accepts a legacy single-byte CSV (windows-1250)", async () => {
    const body = new Uint8Array([...CSV, 0xe8, 0x0a]);

    await expect(readStatementUpload(upload(body))).resolves.toMatchObject({ kind: "csv" });
  });

  it.each([
    ["a PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["a JPEG", [0xff, 0xd8, 0xff, 0xe0]],
    ["a zip or xlsx", [0x50, 0x4b, 0x03, 0x04]],
    ["an old xls", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ["a Windows executable", [0x4d, 0x5a, 0x90, 0x00]],
    ["a GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["a gzip file", [0x1f, 0x8b, 0x08]],
  ])("refuses %s sent as text/csv, whatever its header says", async (_name, signature) => {
    const error = await refusal(readStatementUpload(upload(withPrefix(signature))));

    expect(error).toMatchObject({ code: "unsupported_type", status: 415, message: "That file isn't a CSV statement." });
  });

  it("refuses a NUL byte in the first 8 KB, but not one after it", async () => {
    const early = new Uint8Array(10_000).fill(0x61);
    early[8_191] = 0;
    const late = new Uint8Array(10_000).fill(0x61);
    late[8_192] = 0;

    const error = await refusal(readStatementUpload(upload(early)));
    expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
    await expect(readStatementUpload(upload(late))).resolves.toMatchObject({ kind: "csv" });
  });

  it("refuses a NUL byte in the very first bytes", async () => {
    const error = await refusal(readStatementUpload(upload(new Uint8Array([0x44, 0x00, 0x61, 0x74]))));

    expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
  });

  it("refuses a CSV sent as application/pdf", async () => {
    const error = await refusal(readStatementUpload(upload(CSV, { "content-type": PDF_TYPE })));

    expect(error).toMatchObject({ code: "unsupported_type", status: 415, message: "That file isn't a PDF statement." });
  });

  it("refuses a PNG sent as application/pdf", async () => {
    const error = await refusal(readStatementUpload(upload(withPrefix([0x89, 0x50, 0x4e, 0x47]), { "content-type": PDF_TYPE })));

    expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
  });

  it("reads a PDF as a PDF, sent as application/pdf or as text/csv", async () => {
    await expect(readStatementUpload(upload(PDF, { "content-type": PDF_TYPE }))).resolves.toMatchObject({ kind: "pdf" });
    await expect(readStatementUpload(upload(PDF))).resolves.toMatchObject({ kind: "pdf" });
  });

  it("finds %PDF- anywhere in the first 1,024 bytes of a declared PDF, and not after", async () => {
    const within = new Uint8Array(1_100).fill(0x20);
    within.set(PDF.subarray(0, 5), 1_019);
    const after = new Uint8Array(1_100).fill(0x20);
    after.set(PDF.subarray(0, 5), 1_020);

    await expect(readStatementUpload(upload(within, { "content-type": PDF_TYPE }))).resolves.toMatchObject({ kind: "pdf" });
    const error = await refusal(readStatementUpload(upload(after, { "content-type": PDF_TYPE })));
    expect(error).toMatchObject({ code: "unsupported_type", status: 415 });
  });

  it("does not take a CSV that merely mentions %PDF- for a PDF", async () => {
    const body = text("Date,Description,Amount\n2026-09-01,Invoice %PDF-1,-4.50\n");

    await expect(readStatementUpload(upload(body))).resolves.toMatchObject({ kind: "csv" });
  });

  it("never puts the file's content in a message", async () => {
    const secret = "SECRET-MERCHANT-TEXT";
    const body = new Uint8Array([...withPrefix([0x50, 0x4b, 0x03, 0x04]), ...text(secret)]);

    const error = await refusal(readStatementUpload(upload(body)));

    expect(error.message).not.toContain(secret);
  });
});

describe("recordImportUploadAttempt", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T09:00:00.000Z"));
    resetRateLimits();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets 30 attempts through an hour and refuses the 31st with a 429", () => {
    for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      expect(() => recordImportUploadAttempt("user-a")).not.toThrow();
    }

    let error: unknown;
    try {
      recordImportUploadAttempt("user-a");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code: "rate_limited", status: 429, message: TOO_MANY_IMPORT_UPLOADS });
  });

  it("counts each user separately and forgets an attempt an hour later", () => {
    for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) recordImportUploadAttempt("user-a");

    expect(() => recordImportUploadAttempt("user-b")).not.toThrow();
    expect(() => recordImportUploadAttempt("user-a")).toThrow(ImportError);

    vi.advanceTimersByTime(IMPORT_UPLOAD_WINDOW_MS);
    expect(() => recordImportUploadAttempt("user-a")).not.toThrow();
  });

  it("does not count a refused attempt a second time", () => {
    for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) recordImportUploadAttempt("user-a");
    expect(() => recordImportUploadAttempt("user-a")).toThrow(ImportError);

    vi.advanceTimersByTime(IMPORT_UPLOAD_WINDOW_MS);
    for (let attempt = 0; attempt < IMPORT_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
      expect(() => recordImportUploadAttempt("user-a")).not.toThrow();
    }
  });
});
