import { amountToCents } from "@/lib/imports/amount";
import type { DuplicateOf, DraftRow } from "@/lib/imports/types";
import type { Expense } from "@/lib/expenses/types";

/**
 * Possible duplicates (docs/statement-import-plan.md, "Duplicate matching"). Pure: no storage, no
 * clock. A draft row matches an existing expense when the date is the same, the amount is the same
 * to the cent, and the merchant is similar; the match is one-to-one.
 */

/** The fields of a draft row the matcher reads. */
export type DuplicateCandidate = Pick<DraftRow, "expenseDate" | "description" | "amount">;

/** The fields of an existing expense the matcher reads, and the ones it quotes back. */
export type ExistingExpense = Pick<Expense, "id" | "description" | "expenseDate" | "amount" | "notes">;

/** Word sets overlapping by at least this share (Jaccard) make two merchants similar. */
export const MERCHANT_SIMILARITY_THRESHOLD = 0.5;

/**
 * The shortest normalised name that counts as "contained in" another. A one- or two-letter name
 * would sit inside almost any description, so those can only match by word overlap.
 */
const MIN_CONTAINED_LENGTH = 3;

/**
 * Lower case, accents removed, digits and punctuation dropped, spaces collapsed: "Lidl Nr. 1234,
 * Cluj" and "LIDL CLUJ" both become "lidl nr cluj" and "lidl cluj". Letters of any script are kept.
 */
export function normaliseMerchant(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, " ")
    .trim();
}

/**
 * The merchant an existing expense's notes carry in the `source:` part of the statement envelope
 * (`BT Star Forte statement 2026-08; processed: ...; transaction: ...; source: OMV 1642 Satu Mare`),
 * or null. Existing expenses can hold a neutral description such as "Card payment" while the real
 * merchant is here.
 */
export function notesSource(notes: string | null): string | null {
  if (!notes) return null;
  const match = /(?:^|;)\s*source:\s*([^;]+?)\s*$/i.exec(notes);
  return match ? match[1] : null;
}

/** Whether two merchant names, already normalised, are the same shop: one contains the other, or the words overlap by half. */
function similarNormalised(a: string, b: string): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= MIN_CONTAINED_LENGTH && long.includes(short)) return true;

  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared += 1;
  return shared / (wordsA.size + wordsB.size - shared) >= MERCHANT_SIMILARITY_THRESHOLD;
}

/** Whether two merchant descriptions are similar (see `normaliseMerchant`). */
export function similarMerchants(a: string, b: string): boolean {
  return similarNormalised(normaliseMerchant(a), normaliseMerchant(b));
}

/**
 * For each draft row, in order, the existing expense it looks like, or null. An existing expense is
 * matched by at most one row: the first row, by position in `rows`, that fits it takes it, so two
 * identical coffees in the statement against one already saved flag only the first. When several
 * expenses fit a row, the first of them in `existing` is taken. A row is compared with an
 * expense's description and, when its notes carry one, the envelope's `source:` merchant.
 */
export function flagDuplicates(
  rows: readonly DuplicateCandidate[],
  existing: readonly ExistingExpense[],
): (DuplicateOf | null)[] {
  const byDayAndAmount = new Map<string, { expense: ExistingExpense; merchants: string[] }[]>();
  for (const expense of existing) {
    const key = `${expense.expenseDate}|${amountToCents(expense.amount)}`;
    const source = notesSource(expense.notes);
    const merchants = [normaliseMerchant(expense.description), ...(source ? [normaliseMerchant(source)] : [])];
    const bucket = byDayAndAmount.get(key) ?? [];
    bucket.push({ expense, merchants });
    byDayAndAmount.set(key, bucket);
  }

  const taken = new Set<string>();
  return rows.map((row) => {
    const candidates = byDayAndAmount.get(`${row.expenseDate}|${amountToCents(row.amount)}`) ?? [];
    const merchant = normaliseMerchant(row.description);
    const match = candidates.find(
      ({ expense, merchants }) => !taken.has(expense.id) && merchants.some((other) => similarNormalised(merchant, other)),
    );
    if (!match) return null;
    taken.add(match.expense.id);
    const { id, description, expenseDate, amount } = match.expense;
    return { id, description, expenseDate, amount };
  });
}
