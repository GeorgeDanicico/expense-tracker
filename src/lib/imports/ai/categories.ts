import { subtypeForCategory, type ExpenseCategory, type ExpenseSubtype } from "@/lib/expenses/categories";
import type { MerchantCategory } from "@/lib/expenses/repository";
import { normaliseMerchant } from "@/lib/imports/duplicates";
import type { CategorySource } from "@/lib/imports/types";

/**
 * Where a draft row's first category comes from (docs/statement-import-plan.md, "Where a row's
 * category comes from"), in this order:
 *
 * 1. a merchant rule, which the database applies inside `create_import_batch` and which wins;
 * 2. the user's own history: the category of their most recent expense with the same normalised
 *    merchant in the last 12 months, worked out here in code, so the history is never sent anywhere;
 * 3. the model's category.
 *
 * Steps 1 and 2 run before any model call, so a merchant they know is never sent. Pure code: the
 * history is read by the caller (`ExpenseRepository.recentCategoriesByMerchant`).
 */

/** How far back the user's history reaches. */
export const HISTORY_MONTHS = 12;

export type Classification = {
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
};

/** A category chosen by the user's history or the model, with where it came from. */
export type Assignment = Classification & { source: Exclude<CategorySource, "rule"> };

/** The user's classification by normalised merchant (`normaliseMerchant`). */
export type MerchantHistory = ReadonlyMap<string, Classification>;

/** The first day the history reaches back to: `HISTORY_MONTHS` before `today` (`YYYY-MM-DD`). */
export function historySince(today: string): string {
  const year = Number(today.slice(0, 4)) - HISTORY_MONTHS / 12;
  const rest = today.slice(4);
  // 29 February has no counterpart a year earlier; the day after the 28th does.
  return rest === "-02-29" ? `${year}-02-28` : `${year}${rest}`;
}

/**
 * The history from the user's categorised expenses, newest first (as `recentCategoriesByMerchant`
 * returns them): for each normalised merchant the first, that is the most recent, expense wins.
 * A description with nothing but digits and punctuation has no merchant and is left out.
 */
export function buildHistory(rows: readonly MerchantCategory[]): MerchantHistory {
  const history = new Map<string, Classification>();
  for (const row of rows) {
    const key = normaliseMerchant(row.description);
    if (key === "" || history.has(key)) continue;
    history.set(key, { category: row.category, subtype: subtypeForCategory(row.category, row.subtype) });
  }
  return history;
}

/**
 * The descriptions the database's merchant rule recognises
 * (`expense_classification_private.merchant_key`, after its whitespace and case normalisation).
 * `categories.test.ts` compares this list with the migration, so a rule added there fails the test
 * until it is added here.
 *
 * This only decides which merchants are not sent to the model. The rule itself runs in
 * `create_import_batch`, where it wins whatever category the row was given, so a merchant missing
 * from this list is harmless: it is sent, and the database overrides the answer.
 */
export const MERCHANT_RULE_DESCRIPTIONS: readonly string[] = [
  "autonet",
  "autonet satu mare",
  "autonet str. aurel vlaicu nr. 78 satu mare",
  "omv",
  "omv 1642 satu mare",
  "omv 1947 satu mare",
  "omv 1642 bdul lucian blaga 120 satu mare",
  "omv 1947 b-dul henri coanda nr. 7 satu mare",
  "petrom",
  "cnair road toll - tm28pnw",
  "cnair road toll - sm23dif",
  "allianz-tiriac insurance",
];

const RULE_DESCRIPTIONS = new Set(MERCHANT_RULE_DESCRIPTIONS);

/** Whether the database's merchant rule recognises this description (the SQL normalisation: trimmed, one space, lower case). */
export function matchesMerchantRule(description: string): boolean {
  return RULE_DESCRIPTIONS.has(description.replace(/\s+/g, " ").trim().toLowerCase());
}

/** What is known about one row before any model call. */
export type RowPlan =
  /** The database's merchant rule will set it. */
  | { kind: "rule" }
  | { kind: "history"; assignment: Assignment }
  /** Nothing knows this merchant: it is for the model. `group` indexes `CategoryPlan.unknown`. */
  | { kind: "unknown"; group: number };

export type CategoryPlan = {
  /** One per row, in order. */
  rows: RowPlan[];
  /** The distinct merchants nobody knew, in order of first appearance: what mode "categorise" sends. */
  unknown: string[];
};

/** A key that groups rows of one merchant: the normalised name, or the plain text when nothing is left of it. */
function groupKey(description: string): string {
  return normaliseMerchant(description) || description.trim().toLowerCase();
}

/**
 * Sorts the rows into those the merchant rule knows, those the user's history knows and those left
 * for the model, and lists the distinct merchants of the last group once each.
 */
export function planCategories(descriptions: readonly string[], history: MerchantHistory): CategoryPlan {
  const groups = new Map<string, number>();
  const unknown: string[] = [];
  const rows = descriptions.map((description): RowPlan => {
    if (matchesMerchantRule(description)) return { kind: "rule" };
    const known = history.get(normaliseMerchant(description));
    if (known) return { kind: "history", assignment: { ...known, source: "history" } };

    const key = groupKey(description);
    let group = groups.get(key);
    if (group === undefined) {
      group = unknown.length;
      groups.set(key, group);
      unknown.push(description);
    }
    return { kind: "unknown", group };
  });
  return { rows, unknown };
}

/**
 * The category each row starts with: the history's, or the model's for a merchant nobody knew
 * (`fromModel` gets the plan's group), or null for Other. A row the merchant rule knows is null
 * too: the database sets that one.
 */
export function assignCategories(
  plan: CategoryPlan,
  fromModel: (group: number, row: number) => Classification | null,
): (Assignment | null)[] {
  return plan.rows.map((row, index) => {
    if (row.kind === "history") return row.assignment;
    if (row.kind === "rule") return null;
    const answer = fromModel(row.group, index);
    return answer ? { category: answer.category, subtype: subtypeForCategory(answer.category, answer.subtype), source: "ai" } : null;
  });
}
