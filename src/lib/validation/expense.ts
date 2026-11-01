import { z } from "zod";

import {
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  subtypeForCategory,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { Expense } from "@/lib/expenses/types";

const AMOUNT_FORMAT_MESSAGE = "Enter an amount like 12.50.";
const AMOUNT_DECIMALS_MESSAGE = "Use at most two decimal places.";
const PLAIN_DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const SCIENTIFIC = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;

/** Why `value` is not an amount of at most two decimal places, or null when it is one. */
function amountProblem(value: string | number): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return AMOUNT_FORMAT_MESSAGE;
    text = String(value);
  } else {
    text = value.trim();
    if (PLAIN_DECIMAL.test(text)) return decimalPlaces(text) > 2 ? AMOUNT_DECIMALS_MESSAGE : null;
    if (!SCIENTIFIC.test(text)) return AMOUNT_FORMAT_MESSAGE;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return AMOUNT_FORMAT_MESSAGE;
    text = String(parsed);
  }
  // `String(number)` is the shortest text that reads back as the same number, so 0.1 + 0.2 shows its
  // 0.30000000000000004 and 1.005 stays 1.005: no multiplying, no rounding. It switches to an exponent
  // only below 1e-6 (never a whole number, so never an amount) or from 1e21 (always whole, and caught
  // by the maximum).
  if (/e/i.test(text)) return Number.isInteger(Number(text)) ? null : AMOUNT_DECIMALS_MESSAGE;
  return decimalPlaces(text) > 2 ? AMOUNT_DECIMALS_MESSAGE : null;
}

/** The digits after the point, not counting trailing zeros ("12.340" has two). */
function decimalPlaces(plain: string): number {
  const fraction = plain.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

/**
 * The amount as a caller may send it, with no rules yet. The MCP tools advertise this, so a wrong amount
 * gets `expenseAmountSchema`'s field error from the tool's own handler, not a generic validation failure.
 */
export const expenseAmountInput = z
  .union([z.number(), z.string()], AMOUNT_FORMAT_MESSAGE)
  .describe("A positive amount in the account currency, at most two decimal places, like 12.50");

/**
 * An expense amount: a number, or the text of one ("12.5", from a form), of at most two decimal places
 * and in 0.01 to 9,999,999,999.99, as `numeric(12, 2)` can hold. More decimals are refused with a field
 * error rather than rounded by the database (0.005 would become 0.01) or failing its check (0.004
 * would round to 0). The decimals are counted on the text, never by multiplying. Reminder templates,
 * import confirmations and the MCP expense tools take their amount from this schema.
 */
export const expenseAmountSchema = expenseAmountInput
  .superRefine((value, context) => {
    const problem = amountProblem(value);
    if (problem) context.addIssue({ code: "custom", message: problem });
  })
  .pipe(z.coerce.number<string | number>().positive("Amount must be greater than zero.").max(9_999_999_999.99, "Amount must be at most 9,999,999,999.99."));

export const expenseSchema = z.object({
  description: z.string().trim().min(1, "Enter a description.").max(120),
  amount: expenseAmountSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  subtype: z.enum(EXPENSE_SUBTYPES).nullable().optional().default(null),
  expenseDate: z.iso.date("Choose a valid date."),
  notes: z.string().trim().max(500).optional(),
}).superRefine((expense, context) => {
  if (expense.subtype && SUBTYPE_CATEGORIES[expense.subtype] !== expense.category) {
    context.addIssue({ code: "custom", path: ["subtype"], message: "Choose a subtype belonging to the selected category." });
  }
});

/** A validated expense, ready to store. */
export type ExpenseInput = z.output<typeof expenseSchema>;

/** A partial change to a stored expense; `applyExpensePatch` validates the merged result. */
export type ExpensePatch = Partial<{
  description: string;
  amount: number | string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
  notes: string | null;
}>;

/**
 * Merges the patch into the stored expense and re-validates the whole expense with `expenseSchema`,
 * throwing its ZodError for an invalid result. A category change without an explicit subtype keeps
 * the stored subtype only when it still belongs.
 */
export function applyExpensePatch(current: Expense, patch: ExpensePatch): ExpenseInput {
  const category = patch.category ?? current.category;
  const subtype = patch.subtype !== undefined
    ? patch.subtype
    : patch.category !== undefined ? subtypeForCategory(category, current.subtype) : current.subtype;
  const notes = patch.notes !== undefined ? patch.notes ?? "" : current.notes ?? undefined;
  return expenseSchema.parse({
    description: patch.description ?? current.description,
    amount: patch.amount ?? current.amount,
    category,
    subtype,
    expenseDate: patch.expenseDate ?? current.expenseDate,
    notes,
  });
}
