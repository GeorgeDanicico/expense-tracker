import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import { matchesMerchantRule, type Classification } from "@/lib/imports/ai/categories";
import type { ExpectedRow } from "@/lib/imports/ai/__eval__/types";
import type { VerifiedRow } from "@/lib/imports/ai/verify";

/**
 * How the eval decides a reading is right (docs/statement-import-plan.md, I19). Pure code.
 *
 * A row is **exactly right** when a reading row has the same date, the same amount to the cent, the
 * same currency, the same direction (money out or in) and a merchant that matches by the rule below.
 * Each reading row can satisfy one expected row, so a row listed twice must be read twice.
 *
 * A merchant **matches** when every word of the expected name is among the words of the model's
 * (case and accents folded) and the model added at most three more. So "Lidl Cluj" matches
 * "Lidl Cluj" and "Lidl Cluj Napoca", but not "Lidl" (a word is missing) and not "POS 4411 LIDL
 * CLUJ RO" (the noise the prompt says to drop is still there). Verification has already shown every
 * word to be written on the cited lines, so extra words are never invented, only not cleaned.
 *
 * A **category** is right when the category equals the expected one; with its **subtype** when the
 * subtype equals too (only `car` has any). Only rows that were read exactly right and are money out
 * are scored, and not the merchants the database's merchant rule already knows, since the rule
 * overrides the model for them. Money in is not categorised by the app.
 */

export const MAX_EXTRA_MERCHANT_WORDS = 3;

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function merchantMatches(expected: string, actual: string): boolean {
  const wanted = words(expected);
  const got = words(actual);
  if (wanted.length === 0) return false;
  const have = new Set(got);
  return wanted.every((word) => have.has(word)) && got.length <= wanted.length + MAX_EXTRA_MERCHANT_WORDS;
}

const toCents = (amount: number | string) => Math.round(Number(amount) * 100);

function sameRow(expected: ExpectedRow, actual: VerifiedRow): boolean {
  return (
    expected.date === actual.expenseDate &&
    toCents(expected.amount) === toCents(actual.amount) &&
    expected.currency === actual.currency &&
    expected.direction === actual.direction &&
    merchantMatches(expected.merchant, actual.description)
  );
}

export type ReadScore = {
  expectedRows: number;
  /** Expected rows read exactly right. */
  matchedRows: number;
  /** Rows the reading has that no expected row accounts for. */
  extraRows: number;
  /** Matched rows of money out whose category was checked. */
  categoryScored: number;
  categoryCorrect: number;
  categorySubtypeCorrect: number;
};

export function sameClassification(expected: { category: ExpenseCategory; subtype: ExpenseSubtype | null }, actual: Classification | null) {
  const category = actual?.category === expected.category;
  return { category, withSubtype: category && (actual?.subtype ?? null) === (expected.subtype ?? null) };
}

/** Scores the rows code verified against the rows the statement should give. */
export function scoreReading(expected: readonly ExpectedRow[], actual: readonly VerifiedRow[]): ReadScore {
  const used = new Set<number>();
  const score: ReadScore = {
    expectedRows: expected.length,
    matchedRows: 0,
    extraRows: 0,
    categoryScored: 0,
    categoryCorrect: 0,
    categorySubtypeCorrect: 0,
  };

  for (const row of expected) {
    const index = actual.findIndex((candidate, position) => !used.has(position) && sameRow(row, candidate));
    if (index < 0) continue;
    used.add(index);
    score.matchedRows += 1;

    const found = actual[index];
    if (row.direction !== "debit" || matchesMerchantRule(found.description)) continue;
    const verdict = sameClassification(row, found.suggestion);
    score.categoryScored += 1;
    if (verdict.category) score.categoryCorrect += 1;
    if (verdict.withSubtype) score.categorySubtypeCorrect += 1;
  }

  score.extraRows = actual.length - used.size;
  return score;
}

/** Whether a reading is perfect: every expected row right, nothing extra, every scored category right. */
export function isPerfect(score: ReadScore): boolean {
  return score.matchedRows === score.expectedRows && score.extraRows === 0 && score.categorySubtypeCorrect === score.categoryScored;
}
