import { z } from "zod";

import {
  EXPENSE_CATEGORIES,
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";

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

/** The message for a subtype that doesn't belong to the expense's category; the SQL's update_expense uses it too. */
export const SUBTYPE_CATEGORY_MESSAGE = "Choose a subtype belonging to the selected category.";

/** Line breaks and tabs, which a one-line description turns into a space. */
const LINE_BREAKS = /[\t\n\r]+/g;
/**
 * The other C0 control characters and DEL. XML 1.0 refuses them, so one in a stored description made
 * the spreadsheet export "damaged" in Excel (audit B8); bank statements and MCP clients send them.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** `text` as one line: line breaks and tabs become a space and other control characters are dropped. */
export function oneLine(text: string) {
  return text.replace(LINE_BREAKS, " ").replace(CONTROL_CHARACTERS, "");
}

/** `text` with control characters dropped, keeping line breaks and tabs (notes). */
function withoutControlCharacters(text: string) {
  return text.replace(CONTROL_CHARACTERS, "");
}

const description = z.string().overwrite(oneLine).trim().min(1, "Enter a description.").max(120, "Use at most 120 characters.");
const notes = z.string().overwrite(withoutControlCharacters).trim().max(500, "Use at most 500 characters.");

/**
 * A new expense, as the REST route, the MCP tools, reminder templates and import confirmations all
 * take it: one schema, so the transports can't drift (audit D10). The description is one line with
 * no control characters, and the amount has at most two decimals (B1).
 */
export const expenseSchema = z.object({
  description,
  amount: expenseAmountSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  subtype: z.enum(EXPENSE_SUBTYPES).nullable().optional().default(null),
  expenseDate: z.iso.date("Choose a valid date."),
  notes: notes.optional(),
}).superRefine((expense, context) => {
  if (expense.subtype && SUBTYPE_CATEGORIES[expense.subtype] !== expense.category) {
    context.addIssue({ code: "custom", path: ["subtype"], message: SUBTYPE_CATEGORY_MESSAGE });
  }
});

/** A validated expense, ready to store. */
export type ExpenseInput = z.output<typeof expenseSchema>;

/** A partial change to a stored expense, as a caller sends it; `validateExpensePatch` checks it. */
export type ExpensePatch = Partial<{
  description: string;
  amount: number | string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
  notes: string | null;
}>;

/** A checked patch: only the fields it names, each valid, ready to store. Cleared notes are null. */
export type ExpenseChanges = Partial<{
  description: string;
  amount: number;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
  expenseDate: string;
  notes: string | null;
}>;

const fields = expenseSchema.shape;

/** A change to some fields of an expense, each checked like `expenseSchema`'s; MCP's `update_expense` extends it. */
export const expensePatchSchema = z.object({
  description: fields.description.optional(),
  amount: fields.amount.optional(),
  category: fields.category.optional(),
  subtype: z.enum(EXPENSE_SUBTYPES).nullable().optional(),
  expenseDate: fields.expenseDate.optional(),
  notes: notes.nullable().optional(),
}).superRefine((patch, context) => {
  if (patch.subtype && patch.category !== undefined && SUBTYPE_CATEGORIES[patch.subtype] !== patch.category) {
    context.addIssue({ code: "custom", path: ["subtype"], message: SUBTYPE_CATEGORY_MESSAGE });
  }
});

/** Whether a patch (with or without an `id`) names at least one field to change. */
export function hasExpenseChange(patch: Record<string, unknown>) {
  return Object.entries(patch).some(([key, field]) => key !== "id" && field !== undefined);
}

/** A change sent to `PATCH /api/expenses/[id]`: the patch schema, with at least one field. */
export const expenseChangeSchema = expensePatchSchema.refine(hasExpenseChange, "Provide at least one change.");

/**
 * Checks each field the patch names with `expenseSchema`'s rules, and a subtype against a category
 * named with it, throwing a ZodError with the same field messages. Fields the patch doesn't name are
 * left out, so only the changed fields are written (S10: two edits to different fields both stick).
 * The rules that need the stored expense are the database's (`update_expense`): a new category
 * drops a subtype that doesn't belong to it, and a subtype named alone must belong to the stored
 * category.
 */
export function validateExpensePatch(patch: ExpensePatch): ExpenseChanges {
  const parsed = expensePatchSchema.parse(patch);
  const changes: ExpenseChanges = {};
  if (parsed.description !== undefined) changes.description = parsed.description;
  if (parsed.amount !== undefined) changes.amount = parsed.amount;
  if (parsed.category !== undefined) changes.category = parsed.category;
  if (parsed.subtype !== undefined) changes.subtype = parsed.subtype;
  if (parsed.expenseDate !== undefined) changes.expenseDate = parsed.expenseDate;
  if (parsed.notes !== undefined) changes.notes = parsed.notes || null;
  return changes;
}
