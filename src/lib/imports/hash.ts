import { createHash } from "node:crypto";

import { amountToCents } from "@/lib/imports/amount";
import type { ParsedRow } from "@/lib/imports/types";

/** What the hash reads of a row; the direction isn't part of it (the draft holds debits only). */
export type HashableRow = Pick<ParsedRow, "expenseDate" | "description" | "amount" | "currency">;

/** Lower case, accents removed, whitespace collapsed: so spacing and case never change the hash. */
function normaliseDescription(description: string): string {
  return description
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identifies a statement by its rows, not by the file's bytes, so a re-download of the same
 * statement matches: SHA-256, as 64 lowercase hex characters (what `import_batches.content_hash`
 * checks), of one line per row (date, cents, currency, normalised description, separated by tabs),
 * sorted and joined with newlines. Row order doesn't matter, a repeated row does, and one cent or
 * one day changes the hash. Server only, like the other hashes (`node:crypto`).
 */
export function statementHash(rows: readonly HashableRow[]): string {
  const lines = rows
    .map((row) => [
      row.expenseDate,
      String(amountToCents(row.amount)),
      row.currency.toUpperCase(),
      normaliseDescription(row.description),
    ].join("\t"))
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
