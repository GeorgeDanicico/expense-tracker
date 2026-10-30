import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import type { ImportSourceKind, RowDirection } from "@/lib/imports/types";

/**
 * The shapes of the statement eval (docs/statement-import-plan.md, I19). A statement is a file the
 * reader is given plus the answer it should arrive at; both live next to each other as
 * `<id>.csv|pdf|txt`, `<id>.expected.json` and, for the synthetic ones, `<id>.answer.json`.
 */

/** One transaction as it should come out of the reader. Money in is listed too: the reader returns it and the pipeline counts and drops it. */
export type ExpectedRow = {
  /** `YYYY-MM-DD`, the real date even when the statement prints it without a year. */
  date: string;
  /** The amount, positive, with two decimals ("45.20"). */
  amount: string;
  /** Three uppercase letters. */
  currency: string;
  direction: RowDirection;
  /**
   * The merchant's name in its cleanest form ("Lidl Cluj"). A reading matches when every word of
   * this is in the model's merchant and the model added at most three more (`merchantMatches`).
   */
  merchant: string;
  /** What the model should say for this merchant. Only scored for money out. */
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
};

/** What the generic CSV parser does with the file, so the eval knows whether mode "categorise" applies. */
export type ExpectedParser = "ok" | "none" | "refused";

export type Expected = {
  description: string;
  /** The statement's own currency, when it states one. */
  currency: string | null;
  /**
   * What a parser makes of it. "ok": it reads the rows and the model only categorises. "none": no
   * parser claims it. "refused": a parser claims it but can't read it. Null when not stated (a
   * sample), and then not checked.
   */
  parser: ExpectedParser | null;
  /**
   * A shortcoming of the reader that this statement is here to measure, not a mistake in the
   * statement: the eval still counts the statement as failed, and labels it.
   */
  knownGap: { reason: string; note: string } | null;
  rows: ExpectedRow[];
};

export type EvalStatement = {
  /** The file's name without its extension. */
  id: string;
  kind: ImportSourceKind;
  /** The file as uploaded (a `.txt` sample is turned into a PDF when it is loaded). */
  bytes: Uint8Array;
  expected: Expected;
  /** What a perfect model answers in mode "read". Only the synthetic statements have one; `--dry-run` needs it. */
  answer: ReaderAnswer | null;
};
