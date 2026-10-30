import { z } from "zod";

import type { StructuredOutcome } from "@/lib/ai";
import { usageCostMicros, type ModelPrice } from "@/lib/ai/pricing";
import type { AiProvider, AiUsage } from "@/lib/ai/provider";
import { decodeStatementText } from "@/lib/imports/decode";
import { planCategories, type CategoryPlan } from "@/lib/imports/ai/categories";
import { isPerfect, scoreReading, sameClassification } from "@/lib/imports/ai/__eval__/score";
import type { EvalStatement } from "@/lib/imports/ai/__eval__/types";
import { numberStatement, type NumberedStatement } from "@/lib/imports/ai/numbered-text";
import { categoriseOutputCap, readerOutputCap } from "@/lib/imports/ai/output-cap";
import {
  CATEGORISE_SYSTEM_PROMPT,
  READER_SYSTEM_PROMPT,
  categoriseSchema,
  readerSchema,
} from "@/lib/imports/ai/prompts";
import { categoriseMerchants, readStatement, type ModelRequest, type StatementAi } from "@/lib/imports/ai/reader";
import { verifyReading } from "@/lib/imports/ai/verify";
import { findParser, parseStatement, type StatementSource } from "@/lib/imports/parser";
import { extractPdfText } from "@/lib/imports/pdf-text";
import { maskAccountNumbers } from "@/lib/imports/redact";
import { ImportError } from "@/lib/imports/types";

/**
 * The eval's engine (docs/statement-import-plan.md, I19). It runs the statements through the same
 * code the upload runs: the numbering, the reader's prompts, schemas and output caps
 * (`readStatement`, `categoriseMerchants`), and `verifyReading`, so the numbers it reports are the
 * production reader's. Only the model call itself is different: `evalAi` below sends it straight to
 * a provider and prices the answer from the pricing table, with no per-user budget gate and no
 * ledger (see `run.ts` for why).
 *
 * Two modes, as in production:
 *
 * - "read": the model reads the numbered text and code verifies the rows. Every statement is read,
 *   not only the ones no parser claims, so a CSV a parser would have read still measures how well
 *   the model reads CSVs.
 * - "categorise": only for a statement a parser reads. The parser's debit descriptions, minus the
 *   merchants the database's merchant rule knows, go to the model for a category each. The user's
 *   history is empty here, so every merchant is unknown.
 */

export type Mode = "read" | "categorise";
export const MODES: readonly Mode[] = ["read", "categorise"];
export type Effort = "none" | "low" | "medium" | "high";
export const EFFORTS: readonly Effort[] = ["none", "low", "medium", "high"];

/** The aim, in micros: about one cent a statement (docs/statement-import-plan.md). */
export const AIM_MICROS = 10_000;

/** What the generic CSV parser (the only one registered) makes of a statement. */
export type Parsing =
  | { status: "none" }
  | { status: "refused"; code: string }
  | { status: "ok"; plan: CategoryPlan; debitRows: number };

export type PreparedStatement = {
  statement: EvalStatement;
  numbered: NumberedStatement;
  parsing: Parsing;
};

async function readSource(statement: EvalStatement): Promise<StatementSource> {
  if (statement.kind === "pdf") {
    const pages = await extractPdfText(statement.bytes);
    return { kind: "pdf", text: pages.flat().join("\n"), pages };
  }
  return { kind: "csv", text: decodeStatementText(statement.bytes) };
}

/** Reads the file as an upload would be read, up to the point where the model comes in. */
export async function prepareStatement(statement: EvalStatement): Promise<PreparedStatement> {
  const source = await readSource(statement);
  const numbered = numberStatement(source);

  let parsing: Parsing = { status: "none" };
  if (findParser(source)) {
    try {
      const parsed = parseStatement(source);
      // As the pipeline sees them: debits only, whitespace collapsed, account numbers masked.
      const descriptions = parsed.rows
        .filter((row) => row.direction === "debit")
        .map((row) => maskAccountNumbers(row.description.replace(/\s+/g, " ").trim()));
      parsing = { status: "ok", plan: planCategories(descriptions, new Map()), debitRows: descriptions.length };
    } catch (error) {
      parsing = { status: "refused", code: error instanceof ImportError ? error.code : "error" };
    }
  }
  return { statement, numbered, parsing };
}

// ---------------------------------------------------------------------------------------------
// Jobs and the estimate

export type Job = {
  prepared: PreparedStatement;
  mode: Mode;
  system: string;
  input: string;
  schemaJson: string;
  /** The cap the reader sets, which is also the worst case of the answer's cost. */
  maxOutputTokens: number;
  /** A typical answer, from the plan's figures: about 30 output tokens a transaction and 8 a merchant. */
  expectedOutputTokens: number;
  /** What a perfect model answers, for `--dry-run`; null when it can't be worked out. */
  perfectAnswer: unknown | null;
};

export type Skip = { statementId: string; mode: Mode; reason: string };

const schemaJson = (schema: z.ZodType) => JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
const READER_SCHEMA_JSON = schemaJson(readerSchema);
const CATEGORISE_SCHEMA_JSON = schemaJson(categoriseSchema);

/** Which statements are called in which modes, and why the others aren't. */
export function planJobs(prepared: readonly PreparedStatement[], modes: readonly Mode[]): { jobs: Job[]; skipped: Skip[] } {
  const jobs: Job[] = [];
  const skipped: Skip[] = [];

  for (const item of prepared) {
    const { statement, numbered, parsing } = item;

    if (modes.includes("read")) {
      const merchants = new Set(statement.expected.rows.map((row) => row.merchant)).size;
      jobs.push({
        prepared: item,
        mode: "read",
        system: READER_SYSTEM_PROMPT,
        input: numbered.text,
        schemaJson: READER_SCHEMA_JSON,
        maxOutputTokens: readerOutputCap({ lineCount: numbered.lines.length, transactionLines: numbered.transactionLines.length }),
        expectedOutputTokens: 60 + 30 * statement.expected.rows.length + 8 * merchants,
        perfectAnswer: statement.answer,
      });
    }

    if (modes.includes("categorise")) {
      const debits = statement.expected.rows.filter((row) => row.direction === "debit");
      if (parsing.status === "none") {
        skipped.push({ statementId: statement.id, mode: "categorise", reason: "no parser reads this layout, so production would use mode read" });
      } else if (parsing.status === "refused") {
        skipped.push({ statementId: statement.id, mode: "categorise", reason: `a parser claims it and then refuses it (${parsing.code}); production reads it with mode read instead (see the read row)` });
      } else if (parsing.debitRows !== debits.length) {
        skipped.push({ statementId: statement.id, mode: "categorise", reason: `the parser reads ${parsing.debitRows} debit rows but the expected file has ${debits.length}` });
      } else if (parsing.plan.unknown.length === 0) {
        skipped.push({ statementId: statement.id, mode: "categorise", reason: "every merchant is known to the merchant rule, so nothing is sent" });
      } else {
        const { plan } = parsing;
        const answer = {
          k: plan.unknown.map((_, group) => {
            const first = plan.rows.findIndex((row) => row.kind === "unknown" && row.group === group);
            return { c: debits[first].category, s: debits[first].subtype };
          }),
        };
        jobs.push({
          prepared: item,
          mode: "categorise",
          system: CATEGORISE_SYSTEM_PROMPT,
          input: plan.unknown.join("\n"),
          schemaJson: CATEGORISE_SCHEMA_JSON,
          maxOutputTokens: categoriseOutputCap(plan.unknown.length),
          expectedOutputTokens: 20 + 8 * plan.unknown.length,
          perfectAnswer: answer,
        });
      }
    }
  }
  return { jobs, skipped };
}

/** The same rule as `estimateInputTokens` in `src/lib/ai/index.ts` (that module pulls in the gate and its storage): three characters to the token, rounded up. */
export function estimateJobInputTokens(job: Pick<Job, "system" | "input" | "schemaJson">): number {
  return Math.ceil((job.system.length + job.input.length + job.schemaJson.length) / 3);
}

export type Estimate = {
  calls: number;
  inputTokens: number;
  expectedOutputTokens: number;
  worstOutputTokens: number;
  /** A typical run: the estimated input and the plan's expected output, nothing cached. */
  expectedMicros: number;
  /** The ceiling: the estimated input and every call writing its whole output cap. */
  worstMicros: number;
};

const micros = (price: ModelPrice, inputTokens: number, outputTokens: number) =>
  Math.ceil((inputTokens * price.inputPerMillionMicros + outputTokens * price.outputPerMillionMicros) / 1_000_000);

export function estimateCost(jobs: readonly Job[], price: ModelPrice): Estimate {
  let inputTokens = 0;
  let expectedOutputTokens = 0;
  let worstOutputTokens = 0;
  for (const job of jobs) {
    inputTokens += estimateJobInputTokens(job);
    expectedOutputTokens += job.expectedOutputTokens;
    worstOutputTokens += job.maxOutputTokens;
  }
  return {
    calls: jobs.length,
    inputTokens,
    expectedOutputTokens,
    worstOutputTokens,
    expectedMicros: micros(price, inputTokens, expectedOutputTokens),
    worstMicros: micros(price, inputTokens, worstOutputTokens),
  };
}

// ---------------------------------------------------------------------------------------------
// Running

export type StatementResult = {
  id: string;
  kind: "csv" | "pdf";
  mode: Mode;
  /** "ok": passed verification (read) or gave a usable answer (categorise). "unverified": the model answered and code refused its reading. "failed": no usable answer. */
  outcome: "ok" | "unverified" | "failed";
  /** The verification check or failure that ended it, with the row it failed on; null when it passed. */
  detail: string | null;
  /** The statement is a known gap of the reader (`expected.knownGap`), so a failure is expected and labelled. */
  knownGap: boolean;
  /** Rows the statement should give (mode read: all; mode categorise: the debit rows). */
  expectedRows: number;
  /** Mode read only. */
  matchedRows: number;
  extraRows: number;
  categoryScored: number;
  categoryCorrect: number;
  categorySubtypeCorrect: number;
  /** Every row right, nothing extra, every category right. */
  perfect: boolean;
  /** Verification warnings (mode read), by count; their text never quotes the statement. */
  warnings: number;
  /** Rows the model read that code left out because they didn't match the statement (mode read). */
  dropped: number;
  usage: AiUsage | null;
  costMicros: number;
  ms: number;
  /** What the model answered, for the raw results file. */
  answer: unknown | null;
};

export type RunOptions = {
  provider: AiProvider;
  model: string;
  effort: Effort;
  price: ModelPrice;
  timeoutMs?: number;
  /** Called after each statement; awaited, so a caller can save what has been spent so far. */
  onResult?: (result: StatementResult, done: number, total: number) => void | Promise<void>;
};

type CallInfo = { usage: AiUsage | null; costMicros: number; ms: number };

/**
 * The reader's model call, sent straight to the provider and priced from the table. It replaces
 * what `structured` (src/lib/ai/index.ts) does around a call (the budget gate and the ledger)
 * and keeps the call itself: the request is the reader's own, except that reasoning effort comes
 * from the command line.
 */
function evalAi(options: RunOptions, record: (info: CallInfo) => void): StatementAi {
  return {
    async call<T>(request: ModelRequest<T>): Promise<StructuredOutcome<T>> {
      const started = Date.now();
      const result = await options.provider.structured({
        model: options.model,
        system: request.system,
        input: request.input,
        schema: request.schema,
        schemaName: request.schemaName,
        maxOutputTokens: request.maxOutputTokens,
        effort: options.effort,
        timeoutMs: options.timeoutMs ?? 90_000,
      });
      const usage = result.usage;
      const costMicros = usage ? usageCostMicros(options.price, usage) : 0;
      record({ usage, costMicros, ms: Date.now() - started });
      const call = { provider: options.provider.id, model: options.model, usage, costMicros };
      if (result.ok) return { ok: true, value: result.value, ...call, usage: result.usage };
      return { ok: false, called: true, reason: result.reason, ...(result.detail ? { detail: result.detail } : {}), ...call };
    },
    // The eval has no user, so no history: every merchant the merchant rule doesn't know is sent.
    async loadHistory() {
      return new Map();
    },
  };
}

function blank(job: Job, call: CallInfo | null): StatementResult {
  const { statement } = job.prepared;
  return {
    id: statement.id,
    kind: statement.kind,
    mode: job.mode,
    outcome: "failed",
    detail: null,
    knownGap: statement.expected.knownGap !== null,
    expectedRows: job.mode === "read" ? statement.expected.rows.length : statement.expected.rows.filter((row) => row.direction === "debit").length,
    matchedRows: 0,
    extraRows: 0,
    categoryScored: 0,
    categoryCorrect: 0,
    categorySubtypeCorrect: 0,
    perfect: false,
    warnings: 0,
    dropped: 0,
    usage: call?.usage ?? null,
    costMicros: call?.costMicros ?? 0,
    ms: call?.ms ?? 0,
    answer: null,
  };
}

async function runRead(job: Job, ai: StatementAi, take: () => CallInfo | null): Promise<StatementResult> {
  const { statement, numbered } = job.prepared;
  const result = await readStatement(ai, numbered);
  const out = blank(job, take());

  if (result.status !== "ok") {
    out.detail = result.status === "failed" ? `call ${result.reason}` : "call refused";
    return out;
  }
  out.answer = result.answer;

  const verified = verifyReading(result.answer, numbered);
  if (!verified.ok) {
    out.outcome = "unverified";
    out.detail = verified.row === null ? verified.reason : `${verified.reason} (row ${verified.row + 1})`;
    return out;
  }

  const score = scoreReading(statement.expected.rows, verified.rows);
  return {
    ...out,
    outcome: "ok",
    warnings: verified.warnings.length,
    dropped: verified.dropped.length,
    matchedRows: score.matchedRows,
    extraRows: score.extraRows,
    categoryScored: score.categoryScored,
    categoryCorrect: score.categoryCorrect,
    categorySubtypeCorrect: score.categorySubtypeCorrect,
    perfect: isPerfect(score),
  };
}

async function runCategorise(job: Job, ai: StatementAi, take: () => CallInfo | null): Promise<StatementResult> {
  const { statement, parsing } = job.prepared;
  if (parsing.status !== "ok") throw new Error("A categorise job needs a statement a parser reads.");
  const { plan } = parsing;
  const debits = statement.expected.rows.filter((row) => row.direction === "debit");

  const result = await categoriseMerchants(ai, plan.unknown);
  const out = blank(job, take());
  const scored = plan.rows.filter((row) => row.kind === "unknown").length;

  if (result.status !== "ok") {
    out.detail = "no usable answer";
    out.categoryScored = scored;
    return out;
  }

  let category = 0;
  let withSubtype = 0;
  plan.rows.forEach((row, index) => {
    if (row.kind !== "unknown") return;
    const verdict = sameClassification(debits[index], result.classifications[row.group]);
    if (verdict.category) category += 1;
    if (verdict.withSubtype) withSubtype += 1;
  });
  out.answer = result.classifications;
  return {
    ...out,
    outcome: "ok",
    categoryScored: scored,
    categoryCorrect: category,
    categorySubtypeCorrect: withSubtype,
    perfect: withSubtype === scored,
  };
}

/** Runs the jobs one after another (so the order and the spend are easy to follow) and returns a result for each. */
export async function runJobs(jobs: readonly Job[], options: RunOptions): Promise<StatementResult[]> {
  let last: CallInfo | null = null;
  const ai = evalAi(options, (info) => {
    last = info;
  });
  const take = () => {
    const info = last;
    last = null;
    return info;
  };

  const results: StatementResult[] = [];
  for (const job of jobs) {
    let result: StatementResult;
    try {
      result = job.mode === "read" ? await runRead(job, ai, take) : await runCategorise(job, ai, take);
    } catch (error) {
      // Only the class of the error: whatever it says could quote a request.
      result = { ...blank(job, take()), detail: `error ${error instanceof Error ? error.name : "unknown"}` };
    }
    results.push(result);
    await options.onResult?.(result, results.length, jobs.length);
  }
  return results;
}
