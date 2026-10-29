import { withPermission } from "@/lib/http/permission";
import { json } from "@/lib/http/route";
import { createDraft, listImports } from "@/lib/imports/service";
import { readStatementUpload, recordImportUploadAttempt } from "@/lib/imports/upload";

/**
 * The caller's recent imports, newest first: live drafts with their expiry, and confirmed and undone
 * imports with how many of their expenses still exist. Never reads `?member=`: imports are the
 * caller's alone.
 */
export const GET = withPermission("expenses", "edit", async () => {
  return json({ imports: await listImports() });
}, { failure: "Unable to load your imports." });

/**
 * Uploads a statement. The body is the raw file (not multipart), with `Content-Type` `text/csv` or
 * `application/pdf`; the file is read in memory and never stored. Answers `{ batch, reopened,
 * warnings }`: 201 for a new draft, 200 with `reopened: true` when the same statement is still a
 * draft. Refusals answer `{ error, code }`: 413 over the size limit, 415 for another type (by header
 * or by content), 422 for an empty file, an unrecognised layout, no payments or too many rows, 409
 * when the statement was imported already, 429 past 30 attempts an hour.
 *
 * Keep the body raw: `multipart/form-data` would make this a "simple" request that another site's
 * plain HTML form could send. A `text/csv` or `application/pdf` body needs a CORS preflight, which
 * we never grant.
 */
export const POST = withPermission("expenses", "edit", async (request, user) => {
  // Every attempt counts, so it is recorded before the body is read.
  recordImportUploadAttempt(user.id);
  const upload = await readStatementUpload(request);
  const { batch, reopened, warnings } = await createDraft(user.id, upload);
  return json({ batch, reopened, warnings }, reopened ? 200 : 201);
}, { failure: "Unable to read the statement. Please try again." });
