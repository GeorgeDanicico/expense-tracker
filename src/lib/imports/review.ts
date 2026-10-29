import { subtypeForCategory, type ExpenseCategory, type ExpenseSubtype } from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";
import { STATEMENT_PARSERS } from "@/lib/imports/parser";
import {
  IMPORT_DESCRIPTION_MAX_LENGTH,
  type DraftRow,
  type DuplicateOf,
  type ImportBatch,
} from "@/lib/imports/types";

/**
 * The state of the review screen (docs/statement-import-plan.md, task I7): which draft rows are
 * ticked and what the user changed in them. It is local until Confirm, so everything here is pure
 * and the screen is a thin shell over it. No Supabase, Next or UI imports.
 */

/** A draft row as the user is editing it: the row as uploaded, and the choices made on it. */
export type ReviewRow = {
  row: DraftRow;
  ticked: boolean;
  description: string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
};

export type ReviewAction =
  | { type: "toggle"; id: string }
  | { type: "describe"; id: string; description: string }
  | { type: "categorise"; id: string; category: ExpenseCategory }
  | { type: "subtype"; id: string; subtype: ExpenseSubtype | null }
  | { type: "selectAll" }
  | { type: "selectNone" }
  | { type: "selectExceptDuplicates" };

/** A row that can be ticked: in the user's currency. Anything else can't be imported. */
export function isTickable(row: DraftRow): boolean {
  return row.importable;
}

/** A possible duplicate starts unticked; so does a row that can't be imported. */
function startsTicked(row: DraftRow): boolean {
  return isTickable(row) && row.duplicateOf === null;
}

/** The draft as the screen first shows it: duplicates and foreign-currency rows unticked, the rest ticked. */
export function initialReview(rows: readonly DraftRow[]): ReviewRow[] {
  return rows.map((row) => ({
    row,
    ticked: startsTicked(row),
    description: row.description,
    category: row.category,
    subtype: row.subtype,
  }));
}

export function reviewReducer(state: ReviewRow[], action: ReviewAction): ReviewRow[] {
  const change = (id: string, update: (item: ReviewRow) => ReviewRow) =>
    state.map((item) => (item.row.id === id ? update(item) : item));

  switch (action.type) {
    case "toggle":
      return change(action.id, (item) => (isTickable(item.row) ? { ...item, ticked: !item.ticked } : item));
    case "describe":
      return change(action.id, (item) => ({ ...item, description: action.description }));
    case "categorise":
      // A row set by a merchant rule keeps its category: the database applies the same rule on save.
      return change(action.id, (item) => item.row.ruleMatched
        ? item
        : { ...item, category: action.category, subtype: subtypeForCategory(action.category, item.subtype) });
    case "subtype":
      return change(action.id, (item) => item.row.ruleMatched
        ? item
        : { ...item, subtype: subtypeForCategory(item.category, action.subtype) });
    case "selectAll":
      return state.map((item) => ({ ...item, ticked: isTickable(item.row) }));
    case "selectNone":
      return state.map((item) => ({ ...item, ticked: false }));
    case "selectExceptDuplicates":
      return state.map((item) => ({ ...item, ticked: startsTicked(item.row) }));
  }
}

export function tickedRows(state: readonly ReviewRow[]): ReviewRow[] {
  return state.filter((item) => item.ticked);
}

/** The ticked rows' total in the user's currency, summed in cents so it never drifts. */
export function tickedTotal(state: readonly ReviewRow[]): number {
  const cents = tickedRows(state).reduce((sum, item) => sum + Math.round(item.row.amount * 100), 0);
  return cents / 100;
}

/** Why a row's description can't be saved, or `null`. Mirrors `expenseSchema`'s description rule. */
export function descriptionProblem(description: string): string | null {
  const trimmed = description.trim();
  if (!trimmed) return "Enter a description.";
  if (trimmed.length > IMPORT_DESCRIPTION_MAX_LENGTH) {
    return `Use at most ${IMPORT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  return null;
}

/** Problems with the ticked rows that the browser can see, keyed by row id. */
export function rowProblems(state: readonly ReviewRow[]): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const item of tickedRows(state)) {
    const problem = descriptionProblem(item.description);
    if (problem) problems[item.row.id] = problem;
  }
  return problems;
}

/** The body of the confirm route: only the ticked rows, with their final values. */
export function confirmRows(state: readonly ReviewRow[]) {
  return tickedRows(state).map((item) => ({
    id: item.row.id,
    description: item.description.trim(),
    amount: item.row.amount,
    expenseDate: item.row.expenseDate,
    category: item.category,
    subtype: item.subtype,
    notes: item.row.notes,
  }));
}

/**
 * Turns the confirm route's `fieldErrors` (keyed `rows.<index>.<field>`, the index being the
 * position among the rows sent) into one message per row id, and the messages that belong to no
 * row. The first message of a row wins.
 */
export function rowErrorsFromFields(
  fieldErrors: Record<string, string[]> | undefined,
  sent: readonly { id: string }[],
): { byRow: Record<string, string>; other: string[] } {
  const byRow: Record<string, string> = {};
  const other: string[] = [];
  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const index = /^rows\.(\d+)(?:\.|$)/.exec(path)?.[1];
    const target = index === undefined ? undefined : sent[Number(index)];
    if (target) byRow[target.id] ??= messages[0];
    else other.push(...messages);
  }
  return { byRow, other };
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "Add 34 expenses", or "Add expenses" while nothing is ticked. */
export function addLabel(count: number): string {
  return count === 0 ? "Add expenses" : `Add ${pluralize(count, "expense")}`;
}

/** How the parser that read the statement is named on the review screen. */
export function parserLabel(parserId: string): string {
  return STATEMENT_PARSERS.find((parser) => parser.id === parserId)?.label ?? "Statement";
}

function dayParts(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

/** "12 Oct", or "12 Oct 2026" with `year`. */
export function formatDay(date: string, year = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: year ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(dayParts(date));
}

/** "1 Oct to 31 Oct 2026", a single day for one date, or `null` when the statement has no period. */
export function formatPeriod(start: string | null, end: string | null): string | null {
  if (start && end) return start === end ? formatDay(start, true) : `${formatDay(start)} to ${formatDay(end, true)}`;
  const one = start ?? end;
  return one ? formatDay(one, true) : null;
}

/** "Lidl, 12 Oct, 45.20": the existing expense a draft row looks like. */
export function describeDuplicate(duplicate: DuplicateOf): string {
  return `${duplicate.description}, ${formatDay(duplicate.expenseDate)}, ${duplicate.amount.toFixed(2)}`;
}

/** The sentence under a row that is in another currency than the account's. */
export function foreignCurrencyReason(rowCurrency: string, accountCurrency: string): string {
  return `In ${rowCurrency}. Your account is in ${accountCurrency}, so this can't be imported.`;
}

/**
 * The summary line's parts: "37 rows", "3 possible duplicates", "4 incoming payments skipped"; the
 * counts that are zero are left out, except the rows.
 */
export function summaryParts(batch: ImportBatch, rows: readonly DraftRow[]): string[] {
  const duplicates = rows.filter((row) => row.duplicateOf).length;
  const foreign = rows.filter((row) => !row.importable).length;
  return [
    pluralize(rows.length, "row"),
    ...(duplicates ? [pluralize(duplicates, "possible duplicate")] : []),
    ...(foreign ? [`${foreign} in another currency`] : []),
    ...(batch.skippedCredits ? [`${pluralize(batch.skippedCredits, "incoming payment")} skipped`] : []),
  ];
}

/** The months (`YYYY-MM`) the expenses fall in, newest first. */
export function monthsOf(expenses: readonly Pick<Expense, "expenseDate">[]): string[] {
  return [...new Set(expenses.map((expense) => expense.expenseDate.slice(0, 7)))].toSorted().toReversed();
}

/** An amount with two decimals and grouping, no currency: "1,234.50". The row's currency has its own column. */
export function formatPlainAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}
