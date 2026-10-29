import { APPLICATION_TIMEZONE } from "@/lib/calendar";
import { formatPeriod, pluralize } from "@/lib/imports/review";
import type { RecentImport } from "@/lib/imports/repository";
import type { ImportBatch } from "@/lib/imports/types";

/**
 * Wording and rules for the list of recent imports and for undo (docs/statement-import-plan.md,
 * task I8). Pure: the components pass `now` in, so every sentence here is tested without a clock.
 */

/** Shown with the upload step when a draft is opened after its 24 hours (the server answers 404). */
export const IMPORT_EXPIRED_NOTICE = "This import has expired. Upload the statement again.";

/** Shown when a draft was confirmed or undone somewhere else (the server answers 409). */
export const IMPORT_ALREADY_DONE_NOTICE = "That import was already confirmed or undone.";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function dayFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: APPLICATION_TIMEZONE });
}

function yearOf(instant: Date): string {
  return dayFormatter({ year: "numeric" }).format(instant);
}

/**
 * The day an instant falls on in the app's time zone: "3 Oct", or "3 October" with `long`. The year
 * is added when it isn't `now`'s, so an import from last year isn't taken for a recent one.
 */
export function formatInstantDay(iso: string, { now, long = false }: { now: Date; long?: boolean }): string {
  const instant = new Date(iso);
  const day = dayFormatter({ day: "numeric", month: long ? "long" : "short" }).format(instant);
  return yearOf(instant) === yearOf(now) ? day : `${day} ${yearOf(instant)}`;
}

/** True for a draft whose 24 hours are over; the server leaves those out, and so does the list. */
export function isExpired(batch: Pick<ImportBatch, "status" | "expiresAt">, now: Date): boolean {
  return batch.status === "draft" && batch.expiresAt !== null && new Date(batch.expiresAt).getTime() <= now.getTime();
}

/** "expires in 19 h", "expires in 35 min" or "expires in under a minute"; "expired" once it has. */
export function expiresIn(expiresAt: string, now: Date): string {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return "expired";
  if (left < MINUTE) return "expires in under a minute";
  if (left < HOUR) return `expires in ${Math.floor(left / MINUTE)} min`;
  // Rounded up, so a draft with 18 h 20 min left says 19 h: it never promises more time than there is.
  return `expires in ${Math.ceil(left / HOUR)} h`;
}

/** "Statement of 1 Oct to 31 Oct 2026", or "Statement uploaded 3 Oct" for one with no period. */
export function importTitle(batch: ImportBatch, now: Date): string {
  const period = formatPeriod(batch.periodStart, batch.periodEnd);
  return period ? `Statement of ${period}` : `Statement uploaded ${formatInstantDay(batch.createdAt, { now })}`;
}

/** The list row's second line, by status: rows and expiry for a draft, expenses and day for the rest. */
export function importMeta(item: RecentImport, now: Date): string[] {
  const { batch } = item;
  if (batch.status === "draft") {
    return [
      pluralize(batch.rowCount, "row"),
      `uploaded ${formatInstantDay(batch.createdAt, { now })}`,
      batch.expiresAt ? expiresIn(batch.expiresAt, now) : "",
    ].filter(Boolean);
  }
  const count = pluralize(batch.confirmedCount ?? batch.rowCount, "expense");
  if (batch.status === "undone") {
    return [count, batch.undoneAt ? `undone ${formatInstantDay(batch.undoneAt, { now })}` : "undone"];
  }
  return [
    count,
    batch.confirmedAt ? `imported ${formatInstantDay(batch.confirmedAt, { now })}` : "imported",
  ];
}

/** The imports the list shows: drafts that haven't expired yet, then every confirmed and undone one. */
export function visibleImports(imports: readonly RecentImport[], now: Date): RecentImport[] {
  return imports.filter((item) => !isExpired(item.batch, now));
}

/** The undo dialog's title. */
export const UNDO_TITLE = "Undo this import?";

/**
 * What undo says it will do, from the repository's counts: "This removes 37 expenses you imported on
 * 3 October, 2 of them changed since." Expenses edited since the import are removed too (question 4
 * of the plan), so the changed ones are named before the user agrees.
 */
export function undoSummary({ expenseCount, changedCount }: Pick<RecentImport, "expenseCount" | "changedCount">, importedOn: string): string {
  if (expenseCount === 0) {
    return "None of the expenses this import added are left, so nothing is removed.";
  }
  const base = `This removes ${pluralize(expenseCount, "expense")} you imported on ${importedOn}`;
  if (changedCount <= 0) return `${base}.`;
  if (expenseCount === 1) return `${base}, and it has changed since.`;
  return `${base}, ${changedCount >= expenseCount ? "all of them" : `${changedCount} of them`} changed since.`;
}

/**
 * What the undo dialog adds after the counts. Edited expenses go too, and the counts already say how
 * many of those there are, so only what stays and what comes back is said here.
 */
export function undoAdvice({ expenseCount }: Pick<RecentImport, "expenseCount" | "changedCount">): string {
  if (expenseCount === 0) return "The statement can be imported again afterwards.";
  return "Expenses you added yourself stay. The statement can be imported again afterwards.";
}

/** What discarding a draft says it does; the review screen and the list of recent imports both use it. */
export function discardDescription(rowCount: number): string {
  return `The ${pluralize(rowCount, "row")} read from the statement are deleted. Nothing is added to your expenses.`;
}

/** The confirmation line after an undo, in the list. */
export function undoneMessage(removed: number): string {
  return `Import undone. ${pluralize(removed, "expense")} removed.`;
}
