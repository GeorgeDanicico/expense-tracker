import { IMPORT_MAX_ROWS } from "@/lib/imports/types";

/**
 * How much the model may write (docs/statement-import-plan.md, "Limits per statement"). Output is
 * what costs (six times the price of input), and the gate prices the worst case, the whole cap,
 * against what is left of the family's month, so the cap is worked out from the input rather than
 * left at the feature's maximum.
 *
 * Real answers are about 30 output tokens per transaction plus 8 per distinct merchant in mode
 * "read", and 8 per merchant in mode "categorise" (the plan's figures). The cap is the plan's
 * "about 35 tokens per line that looks like a transaction plus 10 per possible merchant", with half
 * as much again on top: a reading that is correct but verbose must not be cut off (a cut-off answer
 * refuses the statement), and a runaway answer is still bounded to a few cents.
 */

/**
 * The most the statements feature may ask for (`AI_FEATURES.statements.maxOutputTokens`; a test keeps
 * the two equal). Kept here so this module stays free of the gate and its storage.
 */
export const MAX_OUTPUT_TOKENS = 32_000;
/** Output tokens budgeted per transaction line. */
export const TOKENS_PER_TRANSACTION = 35;
/** Output tokens budgeted per merchant, in both modes. */
export const TOKENS_PER_MERCHANT = 10;
/** The share added on top of the budget. */
export const HEADROOM = 1.5;
/** The answer's fixed part in mode "read": the statement's currency and printed total, and the braces. */
export const READER_FIXED_TOKENS = 100;
/** The answer's fixed part in mode "categorise". */
export const CATEGORISE_FIXED_TOKENS = 50;
/** Never less than this, so a tiny input cannot get a cap too small for any valid answer. */
export const MIN_OUTPUT_TOKENS = 256;

/** Every transaction is a possible merchant; a statement of lines that do not look like transactions is sized by its length. */
const LINES_PER_TRANSACTION_FALLBACK = 4;

function clamp(tokens: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, Math.ceil(tokens)));
}

/**
 * The cap for mode "categorise": `merchants` distinct merchants, each answered with a short
 * `{c, s}` entry.
 */
export function categoriseOutputCap(merchants: number): number {
  return clamp((CATEGORISE_FIXED_TOKENS + TOKENS_PER_MERCHANT * merchants) * HEADROOM);
}

/**
 * The cap for mode "read". The count of lines that look like a transaction sizes it, with a floor
 * from the statement's length for layouts where the date and the amount sit on different lines
 * (a quarter of the lines, at most the row limit), so a layout the counter misreads is not cut off.
 */
export function readerOutputCap({ lineCount, transactionLines }: { lineCount: number; transactionLines: number }): number {
  const possible = Math.max(transactionLines, Math.min(Math.ceil(lineCount / LINES_PER_TRANSACTION_FALLBACK), IMPORT_MAX_ROWS));
  return clamp((READER_FIXED_TOKENS + (TOKENS_PER_TRANSACTION + TOKENS_PER_MERCHANT) * possible) * HEADROOM);
}
