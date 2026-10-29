import "server-only";

import { readBodyWithLimit } from "@/lib/http/body";
import { importUploadAttempts, TOO_MANY_IMPORT_UPLOADS } from "@/lib/http/rate-limit";
import { HttpError } from "@/lib/http/route";
import {
  IMPORT_CSV_MAX_BYTES,
  IMPORT_PDF_MAX_BYTES,
  ImportError,
  tooLargeMessage,
  type ImportSourceKind,
} from "@/lib/imports/types";

/**
 * The upload guard of a statement import (docs/statement-import-plan.md, task I4): what a request
 * has to be before any parser sees it. The file is only ever held in memory; it is never written
 * anywhere, its name is never read, and no message here contains anything from it.
 */

/** What the guard hands the pipeline: the kind the bytes turned out to be, and the bytes. */
export type StatementUpload = { kind: ImportSourceKind; bytes: Uint8Array };

const CONTENT_TYPES: Record<string, ImportSourceKind> = {
  "text/csv": "csv",
  "application/pdf": "pdf",
};

const MAX_BYTES: Record<ImportSourceKind, number> = {
  csv: IMPORT_CSV_MAX_BYTES,
  pdf: IMPORT_PDF_MAX_BYTES,
};

/** A PDF starts with `%PDF-`, which a reader tolerates anywhere in the first 1,024 bytes. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PDF_SIGNATURE_WINDOW = 1024;

/** How much of the start of a CSV is searched for a NUL byte. */
const NUL_SCAN_BYTES = 8 * 1024;

/**
 * The signatures of files that are never a CSV. `%PDF` isn't listed: a PDF is told apart first.
 * The first five are the plan's list (zip and xlsx, old xls, PNG, JPEG, Windows executables); GIF
 * and gzip are added because they are as common and as obviously not text.
 */
const BINARY_SIGNATURES: readonly { name: string; bytes: readonly number[] }[] = [
  { name: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { name: "xls", bytes: [0xd0, 0xcf, 0x11, 0xe0] },
  { name: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { name: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { name: "exe", bytes: [0x4d, 0x5a] },
  { name: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "gzip", bytes: [0x1f, 0x8b] },
];

const NOT_A_CSV = "That file isn't a CSV statement.";
const NOT_A_PDF = "That file isn't a PDF statement.";

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The offset of `%PDF-` within the first 1,024 bytes, or -1. */
function pdfSignatureOffset(bytes: Uint8Array): number {
  const last = Math.min(bytes.length, PDF_SIGNATURE_WINDOW) - PDF_SIGNATURE.length;
  for (let offset = 0; offset <= last; offset += 1) {
    if (startsWith(bytes, PDF_SIGNATURE, offset)) return offset;
  }
  return -1;
}

function hasUtf16Bom(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff]);
}

/** Whether the bytes look like text: no known binary signature, and no NUL byte early on unless UTF-16. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (hasUtf16Bom(bytes)) return true;
  if (BINARY_SIGNATURES.some((signature) => startsWith(bytes, signature.bytes))) return false;
  const scanned = bytes.subarray(0, NUL_SCAN_BYTES);
  return !scanned.includes(0);
}

/**
 * Counts an upload attempt by `userId` against the hourly limit, refusing with a `rate_limited`
 * `ImportError` (429) when the user is already at it. Every attempt counts, successful or not,
 * because each one costs a parse; call it before reading the body.
 */
export function recordImportUploadAttempt(userId: string): void {
  if (importUploadAttempts.isLimited(userId)) throw new ImportError("rate_limited", TOO_MANY_IMPORT_UPLOADS);
  importUploadAttempts.recordFailure(userId);
}

/**
 * Reads and checks a statement upload. The body is the raw file (never multipart: a plain HTML form
 * on another site could send that), with `Content-Type` `text/csv` or `application/pdf`.
 *
 * 1. The declared type picks the size limit, and anything else is refused (415 `unsupported_type`).
 * 2. The body is read with that limit (413 `file_too_large`, "Choose a statement under 2 MB."), and an
 *    empty one is refused (422 `empty_file`).
 * 3. The content decides what the file is, not the header. A body that starts with `%PDF-` is a PDF
 *    whatever it was declared as, and the caller decides whether PDFs are accepted; a declared PDF
 *    must hold `%PDF-` in its first 1,024 bytes. Anything else must be text: it is refused (415) when
 *    it starts with a known binary signature or has a NUL byte in its first 8 KB, unless it starts
 *    with a UTF-16 byte order mark.
 *
 * The file name is never read.
 */
export async function readStatementUpload(request: Request): Promise<StatementUpload> {
  const declaredType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const declaredKind = declaredType ? CONTENT_TYPES[declaredType] : undefined;
  if (!declaredKind) throw new ImportError("unsupported_type");

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request, MAX_BYTES[declaredKind], tooLargeMessage(declaredKind));
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) {
      throw new ImportError("file_too_large", tooLargeMessage(declaredKind));
    }
    throw error;
  }
  if (bytes.length === 0) throw new ImportError("empty_file");

  if (declaredKind === "pdf") {
    if (pdfSignatureOffset(bytes) === -1) throw new ImportError("unsupported_type", NOT_A_PDF);
    return { kind: "pdf", bytes };
  }
  if (startsWith(bytes, PDF_SIGNATURE)) return { kind: "pdf", bytes };
  if (!looksLikeText(bytes)) throw new ImportError("unsupported_type", NOT_A_CSV);
  return { kind: "csv", bytes };
}
