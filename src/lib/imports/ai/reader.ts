import type { StructuredInput, StructuredOutcome } from "@/lib/ai";
import type { Classification, MerchantHistory } from "@/lib/imports/ai/categories";
import type { NumberedStatement } from "@/lib/imports/ai/numbered-text";
import { categoriseOutputCap, readerOutputCap } from "@/lib/imports/ai/output-cap";
import {
  CATEGORISE_SCHEMA_NAME,
  CATEGORISE_SYSTEM_PROMPT,
  READER_SCHEMA_NAME,
  READER_SYSTEM_PROMPT,
  categoriseSchema,
  readerSchema,
  type ReaderAnswer,
} from "@/lib/imports/ai/prompts";
import { subtypeForCategory } from "@/lib/expenses/categories";

/**
 * The two model calls of the statement reader (docs/statement-import-plan.md, "How a statement is
 * read"), through whatever `StatementAi` is given: the app passes `structured` from `@/lib/ai`
 * (the gate, the provider and the ledger), tests pass the fake provider through it. Nothing here
 * names a provider, and nothing logs the statement, a prompt or an answer.
 *
 * Both run with reasoning effort `none`: the output is small and the checks are in code.
 */

/** A model call as the reader asks for it; `StatementAi.call` adds the feature and the user. */
export type ModelRequest<T> = Omit<StructuredInput<T>, "feature" | "userId">;

/** What the pipeline needs from the AI side. Absent when the user hasn't turned AI on. */
export type StatementAi = {
  call<T>(request: ModelRequest<T>): Promise<StructuredOutcome<T>>;
  /** The user's own category choices by normalised merchant. A failure to read them is the caller's to absorb. */
  loadHistory(): Promise<MerchantHistory>;
};

export type CategoriseResult =
  /** One classification per name, in order. */
  | { status: "ok"; classifications: Classification[] }
  /** Nothing usable came back; `message` is for the review screen. The rows stay Other. */
  | { status: "unavailable"; message: string };

/**
 * Mode "categorise": the distinct merchants nobody knew, one per line, and the model answers with
 * a category for each. An answer with another number of entries cannot be lined up with the
 * names, so it is dropped whole.
 */
export async function categoriseMerchants(ai: StatementAi, names: readonly string[]): Promise<CategoriseResult> {
  const outcome = await ai.call({
    system: CATEGORISE_SYSTEM_PROMPT,
    input: names.join("\n"),
    schema: categoriseSchema,
    schemaName: CATEGORISE_SCHEMA_NAME,
    maxOutputTokens: categoriseOutputCap(names.length),
    effort: "none",
  });

  if (!outcome.ok) {
    return {
      status: "unavailable",
      message: outcome.called
        ? "Categories couldn't be suggested this time, so the payments are left as Other."
        : `Categories weren't suggested, so the payments are left as Other. ${outcome.message}`,
    };
  }
  if (outcome.value.k.length !== names.length) {
    return { status: "unavailable", message: "Categories couldn't be suggested this time, so the payments are left as Other." };
  }
  return {
    status: "ok",
    classifications: outcome.value.k.map((entry) => ({ category: entry.c, subtype: subtypeForCategory(entry.c, entry.s) })),
  };
}

export type ReadResult =
  | { status: "ok"; answer: ReaderAnswer }
  /** The gate or the configuration refused before any call; `message` says why, in words for the user. */
  | { status: "refused"; message: string }
  /** The model was called and gave nothing usable: cut off at the cap, declined, malformed, or the provider failed. */
  | { status: "failed"; reason: "max_tokens" | "refusal" | "invalid_output" | "timeout" | "rate_limited" | "provider_error" };

/** Mode "read": the numbered statement in, the rows, merchant categories and printed total out. */
export async function readStatement(ai: StatementAi, statement: NumberedStatement): Promise<ReadResult> {
  const outcome = await ai.call({
    system: READER_SYSTEM_PROMPT,
    input: statement.text,
    schema: readerSchema,
    schemaName: READER_SCHEMA_NAME,
    maxOutputTokens: readerOutputCap({ lineCount: statement.lines.length, transactionLines: statement.transactionLines.length }),
    effort: "none",
  });
  if (outcome.ok) return { status: "ok", answer: outcome.value };
  if (!outcome.called) return { status: "refused", message: outcome.message };
  return { status: "failed", reason: outcome.reason };
}
