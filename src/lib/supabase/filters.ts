import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";

/**
 * Guards for the few PostgREST filters that are built from strings (security plan S8).
 *
 * `.or()` and `.filter()` take a string that PostgREST parses itself, so a `,` `(` `)` or `.` in a
 * value would change the query. Values passed to `.eq()`, `.in()` and the like are encoded by
 * supabase-js and are safe. Anything string-built goes through this file, and the `no-restricted-syntax`
 * rule in eslint.config.mjs refuses template literals and `+` in those calls.
 */

const CATEGORY_KEYS: readonly string[] = EXPENSE_CATEGORIES;
const SUBTYPE_KEYS: readonly string[] = EXPENSE_SUBTYPES;

/**
 * The `.or()` string that selects expenses whose category is one of `categoryKeys` or whose subtype is
 * one of `subtypeKeys`. The `expense_tabs` check constraint already limits the stored keys to the
 * catalogue; this checks them again, so the guarantee is visible here and holds even for a tab that
 * was never stored. An unknown key throws before any string is built, and so do two empty lists, which
 * would otherwise select every expense.
 */
export function expenseTabMembershipFilter(categoryKeys: readonly string[], subtypeKeys: readonly string[]): string {
  assertKnown("category", categoryKeys, CATEGORY_KEYS);
  assertKnown("subtype", subtypeKeys, SUBTYPE_KEYS);
  if (!categoryKeys.length && !subtypeKeys.length) throw new Error("An expense tab needs at least one category or subtype.");
  const clauses: string[] = [];
  if (categoryKeys.length) clauses.push(`category.in.(${categoryKeys.join(",")})`);
  if (subtypeKeys.length) clauses.push(`subtype.in.(${subtypeKeys.join(",")})`);
  return clauses.join(",");
}

function assertKnown(kind: string, keys: readonly string[], known: readonly string[]) {
  for (const key of keys) {
    // A plain Error: this is a programming or data fault, never something a caller typed.
    if (typeof key !== "string" || !known.includes(key)) throw new Error(`Unknown expense ${kind} key in a tab.`);
  }
}

/**
 * Escapes a user's text for use inside a `like` or `ilike` pattern, so it matches literally:
 * `\`, `%` and `_` get a backslash. PostgREST also turns `*` into `%` before the query runs and a
 * backslash cannot stop that, so `*` becomes `_` (one character, which matches a literal star).
 * Add the wildcards you want around the result, for example `%${escapeLikePattern(term)}%`.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "_");
}
